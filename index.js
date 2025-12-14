const express = require("express");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const cors = require("cors");
const app = express();
require("dotenv").config();
const port = process.env.PORT || 3000;

//middleware
app.use(express.json());
app.use(cors());

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

    app.post("/users", async (req, res) => {
      const user = req.body;
      user.role = "user";
      user.createdAt = new Date();
      const email = user.email;
      const userExists = await usersCollection.findOne({ email });

      if (userExists) {
        return res.send({ message: "user exists" });
      }

      const result = await usersCollection.insertOne(user);
      res.send(result);
    });

    // Create a new Loan
    app.post("/loans", async (req, res) => {
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

    app.get("/loans", async (req, res) => {
      const result = await loansCollection.find().toArray();
      res.send(result);
    });
    app.get("/loans/latest", async (req, res) => {
      try {
        const result = await loansCollection
          .find()
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

        // ✅ FIX: do NOT overwrite res
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
