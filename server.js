const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const { MongoClient } = require("mongodb");
const http = require("http");
const { Server } = require("socket.io");

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
});

const CHAT_ID = "my-love-chat";
const onlineUsers = new Map();

MongoClient.connect(process.env.MONGO_URL)
  .then((client) => {
    const db = client.db("love");
    const messagesCol = db.collection("messages");
    const usersCol = db.collection("llove");

    io.on("connection", (socket) => {
      socket.on("joinChat", (name) => {
        if (!name) return;

        const user = name.toLowerCase().trim();
        socket.join(CHAT_ID);
        onlineUsers.set(socket.id, user);

        io.to(CHAT_ID).emit(
          "updateUserStatus",
          Array.from(new Set(onlineUsers.values()))
        );
      });

      socket.on("sendMessage", async (data) => {
        const message = {
          chatId: CHAT_ID,
          sender: data.sender,
          content: data.content || "",
          image: data.image || null,
          video: data.video || null,
          createdAt: new Date(),
        };

        await messagesCol.insertOne(message);
        io.to(CHAT_ID).emit("receiveMessage", message);
      });

      socket.on("disconnect", () => {
        onlineUsers.delete(socket.id);
        io.to(CHAT_ID).emit(
          "updateUserStatus",
          Array.from(new Set(onlineUsers.values()))
        );
      });
    });

    /* LOGIN */
    app.post("/login", async (req, res) => {
      const { username, password } = req.body;

      const user = await usersCol.findOne({
        username: username.toLowerCase().trim(),
        password: password.trim(),
      });

      if (!user) {
        return res.status(401).json({ success: false });
      }

      res.json({ success: true, name: user.username });
    });

    /* LOAD MESSAGES */
    app.get("/api/messages", async (req, res) => {
      const msgs = await messagesCol
        .find({ chatId: CHAT_ID })
        .sort({ createdAt: 1 })
        .toArray();
      res.json(msgs);
    });

    server.listen(5000, () =>
      console.log("🚀 Server running on port 5000")
    );
  })
  .catch((err) => {
    console.error("MongoDB error:", err);
  });
