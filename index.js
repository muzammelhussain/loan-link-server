const express = require("express");
require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const stripe = require("stripe")(process.env.STRIPE_SECRET);
const cors = require("cors");
const app = express();
const port = process.env.PORT || 3000;

const admin = require("firebase-admin");

const serviceAccount = require("./loan-link-firebase-adminsdk.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

//middleware
app.use(express.json());
app.use(cors());

//token middleware

const verifyFBToken = async (req, res, next) => {
  const token = req.headers.authorization;

  if (!token) {
    return res.status(401).send({ message: "unauthorized access" });
  }

  try {
    const idToken = token.split(" ")[1];
    const decoded = await admin.auth().verifyIdToken(idToken);
    console.log("decoded in the token", decoded);
    req.decoded_email = decoded.email;
    next();
  } catch (err) {
    return res.status(401).send({ message: "unauthorized access" });
  }
};

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@keramot.mqb48yw.mongodb.net/?appName=Keramot`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const db = client.db("loan_link_db");
    const usersCollection = db.collection("users");
    const loansCollection = db.collection("loans");
    const loanApplications = db.collection("applications");
    const paymentCollection = db.collection("payments");

    app.post("/users", async (req, res) => {
      const user = req.body;
      user.role = user.role || "user";
      user.status = "Active";
      user.createdAt = new Date();
      const email = user.email;
      const userExists = await usersCollection.findOne({ email });

      if (userExists) {
        return res.send({ message: "user exists" });
      }

      const result = await usersCollection.insertOne(user);
      res.send(result);
    });

    app.get("/users/:email/role", async (req, res) => {
      const email = req.params.email;
      const query = { email };
      const user = await usersCollection.findOne(query);
      res.send({ role: user?.role || "user" });
    });

    app.get("/users", async (req, res) => {
      const users = await usersCollection.find().toArray();
      res.send(users);
    });

    // admin related apis

    // update user's role api
    app.patch("/users/role/:id", async (req, res) => {
      try {
        const { id } = req.params;
        const { role } = req.body;

        if (!role) {
          return res.status(400).json({ message: "Role is required" });
        }

        const result = await usersCollection.updateOne(
          { _id: new ObjectId(id) },
          {
            $set: {
              role,
              updatedAt: new Date(),
            },
          }
        );

        res.send({ success: true, modifiedCount: result.modifiedCount });
      } catch (error) {
        console.error("Update role error:", error);
        res.status(500).json({ message: "Failed to update role" });
      }
    });

    // suspend user api
    app.patch("/users/suspend/:id", async (req, res) => {
      try {
        const { id } = req.params;
        const { reason, feedback } = req.body;

        if (!reason || !feedback) {
          return res
            .status(400)
            .json({ message: "Reason and feedback are required" });
        }

        const result = await usersCollection.updateOne(
          { _id: new ObjectId(id) },
          {
            $set: {
              status: "Suspended",
              suspendReason: reason,
              suspendFeedback: feedback,
              suspendedAt: new Date(),
            },
          }
        );

        res.send({ success: true, modifiedCount: result.modifiedCount });
      } catch (error) {
        console.error("Suspend user error:", error);
        res.status(500).json({ message: "Failed to suspend user" });
      }
    });

    app.patch("/users/activate/:id", async (req, res) => {
      try {
        const { id } = req.params;

        const result = await usersCollection.updateOne(
          { _id: new ObjectId(id) },
          {
            $set: {
              status: "Active",
              suspendReason: null,
              suspendFeedback: null,
              suspendedAt: null,
              updatedAt: new Date(),
            },
          }
        );

        res.send({ success: true, modifiedCount: result.modifiedCount });
      } catch (error) {
        console.error("Activate user error:", error);
        res.status(500).json({ message: "Failed to activate user" });
      }
    });

    // payment related apis
    app.post("/payment-checkout-session", async (req, res) => {
      const paymentInfo = req.body;
      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            price_data: {
              currency: "usd",
              unit_amount: 1000,
              product_data: {
                name: `Please pay for: ${paymentInfo.loanTitle}`,
              },
            },
            quantity: 1,
          },
        ],
        mode: "payment",
        metadata: {
          loanId: paymentInfo.loanId,
          //trackingId: paymentInfo.trackingId,
        },
        customer_email: paymentInfo.email,
        success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
      });

      res.send({ url: session.url });
    });
    app.patch("/payment-success", async (req, res) => {
      const sessionId = req.query.session_id;
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      //console.log(session);

      const transactionId = session.payment_intent;
      const query = { transactionId: transactionId };

      const paymentExist = await paymentCollection.findOne(query);
      console.log(paymentExist);
      if (paymentExist) {
        return res.send({
          message: "already exists",
          transactionId,
        });
      }

      if (session.payment_status === "paid") {
        const id = session.metadata.loanId;
        const query = { _id: new ObjectId(id) };
        const update = {
          $set: {
            applicationFeeStatus: "paid",
            transactionId: session.payment_intent,
          },
        };
        const result = await loanApplications.updateOne(query, update);
        const payment = {
          amount: session.amount_total / 100,
          currency: session.currency,
          customerEmail: session.customer_email,
          loanId: session.metadata.loanId,
          loanTitle: session.metadata.loanTitle,
          transactionId: session.payment_intent,
          paymentStatus: session.payment_status,
          paidAt: new Date(),
        };
        if (session.payment_status === "paid") {
          const resultPayment = await paymentCollection.insertOne(payment);
          res.send({
            success: true,
            modifyLoans: result,
            transactionId: session.payment_intent,
            paymentInfo: resultPayment,
          });
        }
      }
      res.send({ success: false });
    });

    // all loans admin api
    app.get("/admin/loans", async (req, res) => {
      try {
        const loans = await loansCollection.find().toArray();
        res.send(loans);
      } catch (error) {
        res.status(500).send({ message: "Failed to fetch loans" });
      }
    });

    // toggling showonhome api
    app.patch("/admin/loans/home/:id", async (req, res) => {
      try {
        const { id } = req.params;
        const { showOnHome } = req.body;

        const result = await loansCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { showOnHome } }
        );

        res.send({ success: true, modifiedCount: result.modifiedCount });
      } catch (error) {
        res.status(500).send({ message: "Failed to update home visibility" });
      }
    });
    // delete loan api (admin)
    app.delete("/admin/loans/:id", async (req, res) => {
      try {
        const { id } = req.params;

        const result = await loansCollection.deleteOne({
          _id: new ObjectId(id),
        });

        res.send({ success: true, deletedCount: result.deletedCount });
      } catch (error) {
        res.status(500).send({ message: "Failed to delete loan" });
      }
    });

    app.patch("/admin/loans/:id", async (req, res) => {
      try {
        const { id } = req.params;
        const updatedLoan = req.body;

        const result = await loansCollection.updateOne(
          { _id: new ObjectId(id) },
          {
            $set: {
              ...updatedLoan,
              updatedAt: new Date(),
            },
          }
        );

        res.send({ success: true, modifiedCount: result.modifiedCount });
      } catch (error) {
        res.status(500).send({ message: "Failed to update loan" });
      }
    });

    // Create a new Loan
    app.post("/manager/loans", async (req, res) => {
      try {
        const newLoanData = req.body;
        const loanDocument = {
          ...newLoanData,
          date: new Date(),
        };
        const result = await loansCollection.insertOne(loanDocument);

        res.status(201).json({
          success: true,
          insertedId: result.insertedId,
          message: "Loan record created successfully using insertOne",
        });
      } catch (error) {
        console.error("Error creating loan record:", error.message);
        res.status(400).json({
          success: false,
          error: error.message,
        });
      }
    });
    // app.post("/loans", async (req, res) => {
    //   const data = req.body;
    //   const result = await loansCollection.insertOne(data);
    //   res.status(201).json({
    //     success: true,
    //     insertedId: result.insertedId,
    //     message: "Loan record created successfully using insertOne",
    //   });
    // });

    // GET /loans?page=1&limit=6
    app.get("/loans", async (req, res) => {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 6;

      const skip = (page - 1) * limit;

      const total = await loansCollection.countDocuments();
      const loans = await loansCollection
        .find()
        .skip(skip)
        .limit(limit)
        .toArray();

      res.send({
        loans,
        total,
        page,
        limit,
      });
    });

    app.get("/loans/latest", async (req, res) => {
      try {
        const result = await loansCollection
          .find({ showOnHome: true })
          .sort({ createdAt: -1 }) // newest first
          .limit(6)
          .toArray();

        res.send(result);
      } catch (error) {
        console.log(error);
        res.status(500).send({ message: "Failed to fetch latest crops" });
      }
    });

    app.get("/loans/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await loansCollection.findOne(query);
      res.send(result);
    });

    // GET /manager/loans
    app.get("/manager/loans", async (req, res) => {
      try {
        const loans = await loansCollection.find().toArray();

        res.send(loans);
      } catch (error) {
        res.status(500).send({ message: "Failed to fetch loans" });
      }
    });
    app.get("/manager/loans/:id", async (req, res) => {
      try {
        const loans = await loansCollection.find().toArray();

        res.send(loans);
      } catch (error) {
        res.status(500).send({ message: "Failed to fetch loans" });
      }
    });

    app.patch("/manager/loans/:id", async (req, res) => {
      try {
        const { id } = req.params;
        const updatedLoan = req.body;

        const result = await loansCollection.updateOne(
          { _id: new ObjectId(id) },
          {
            $set: {
              ...updatedLoan,
              updatedAt: new Date(),
            },
          }
        );

        res.send({ success: true, modifiedCount: result.modifiedCount });
      } catch (error) {
        res.status(500).send({ message: "Failed to update loan" });
      }
    });

    // DELETE /manager/loans/:id
    app.delete("/manager/loans/:id", async (req, res) => {
      try {
        const { id } = req.params;

        const result = await loansCollection.deleteOne({
          _id: new ObjectId(id),
        });

        if (result.deletedCount === 0) {
          return res.status(404).send({ message: "Loan not found" });
        }

        res.send({ success: true });
      } catch (error) {
        res.status(500).send({ message: "Delete failed" });
      }
    });

    app.post("/loanApplications", async (req, res) => {
      try {
        const applicationData = req.body;

        if (!applicationData.userEmail || !applicationData.loanId) {
          return res
            .status(400)
            .json({ message: "Missing required fields for application." });
        }

        const existingApplication = await loanApplications.findOne({
          userEmail: applicationData.userEmail,
          loanId: applicationData.loanId,
        });

        if (existingApplication) {
          return res
            .status(409)
            .json({ message: "You have already applied for this loan." });
        }

        const result = await loanApplications.insertOne(applicationData);

        res.status(201).json({
          message: "Loan application successfully submitted.",
          applicationId: result.insertedId,
        });
      } catch (error) {
        console.error("Error submitting loan application:", error);
        res.status(500).json({
          message: "Failed to submit application.",
        });
      }
    });

    app.get("/admin/loan-applications", async (req, res) => {
      try {
        const result = await loanApplications.find().toArray();

        res.status(200).send(result);
      } catch (error) {
        res.status(500).send({ message: "Failed to fetch loan applications" });
      }
    });

    // GET user applications
    app.get(
      "/loanApplications/user/:email",

      async (req, res) => {
        const email = req.params.email;
        const result = await loanApplications
          .find({ userEmail: email })
          .toArray();
        res.send(result);
      }
    );

    // GET /manager/loan-applications/pending api
    app.get("/manager/loan-applications/pending", async (req, res) => {
      try {
        const loans = await loanApplications
          .find({ status: "Pending" })
          .toArray();

        res.send(loans);
      } catch (error) {
        res.status(500).send({ message: "Failed to fetch pending loans" });
      }
    });

    // PATCH /manager/loan-applications/:id/approve

    app.patch("/manager/loan-applications/:id/approve", async (req, res) => {
      try {
        const { id } = req.params;

        const result = await loanApplications.updateOne(
          { _id: new ObjectId(id) },
          {
            $set: {
              status: "Approved",
              approvedAt: new Date(),
            },
          }
        );
        res.send({ success: true, message: "Loan approved" });
      } catch (error) {
        res.status(500).send({ message: "Approval failed" });
      }
    });

    // PATCH /manager/loan-applications/:id/reject
    app.patch("/manager/loan-applications/:id/reject", async (req, res) => {
      try {
        const { id } = req.params;

        const result = await loanApplications.updateOne(
          { _id: new ObjectId(id) },
          {
            $set: {
              status: "Rejected",
              rejectedAt: new Date(),
            },
          }
        );

        res.send({ success: true, message: "Loan rejected" });
      } catch (error) {
        res.status(500).send({ message: "Rejection failed" });
      }
    });

    // GET /manager/loan-applications/approved
    app.get("/manager/loan-applications/approved", async (req, res) => {
      try {
        const loans = await loanApplications
          .find({ status: "Approved" })
          .toArray();

        res.send(loans);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Failed to fetch approved loans" });
      }
    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    //await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("loan-link server is running!!!!!");
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
