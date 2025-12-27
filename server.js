const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const { MongoClient } = require("mongodb");

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;
const mongoURL = process.env.MONGO_URL;

if (!mongoURL) {
  console.error("❌ MONGO_URL is missing in .env file");
  process.exit(1);
}

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB connection
MongoClient.connect(mongoURL)
  .then((client) => {
    console.log("✅ MongoDB connected successfully");

    const db = client.db("love");
    const usersCollection = db.collection("llove");

    // 🔹 Test route
    app.get("/", (req, res) => {
      res.send("Server running 🚀");
    });

    // 🔐 LOGIN ROUTE (ONLY THIS)
    app.post("/login", async (req, res) => {
      try {
        let { username, password } = req.body;

        if (!username || !password) {
          return res
            .status(400)
            .json({ success: false, message: "Username and password required" });
        }

        username = username.trim();
        password = password.trim();

        const user = await usersCollection.findOne({ username, password });

        if (user) {
          res.json({ success: true, message: "Login successful" });
        } else {
          res
            .status(401)
            .json({ success: false, message: "Invalid username or password" });
        }
      } catch (err) {
        console.error("❌ Login error:", err);
        res.status(500).json({ success: false, message: "Server error" });
      }
    });

    // Start server
    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error("❌ Database connection failed:", err.message);
  });
