const express = require("express");
const { MongoClient, ServerApiVersion } = require("mongodb");

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
      const limit = parseInt(req.query.limit) || 6;
      const result = await loansCollection.find().limit(limit).toArray();
      res.send(result);
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
