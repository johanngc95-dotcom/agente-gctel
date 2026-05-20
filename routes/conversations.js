const express = require("express");

const router = express.Router();

// Memoria temporal
let conversations = [];

// =======================
// OBTENER CONVERSACIONES
// =======================

router.get("/", (req, res) => {
  res.json(conversations);
});

// =======================
// CREAR / ACTUALIZAR
// =======================

router.post("/upsert", (req, res) => {
  const {
    phone,
    name,
    message,
    fromMe = false,
  } = req.body;

  let existing = conversations.find(
    (c) => c.phone === phone
  );

  const newMessage = {
    id: Date.now().toString(),
    content: message,
    timestamp: new Date().toISOString(),
    sender: fromMe ? "agent" : "customer",
  };

  // SI YA EXISTE
  if (existing) {
    existing.messages.push(newMessage);

    existing.lastMessage = newMessage;

    existing.lastActivity =
      new Date().toISOString();

    existing.updatedAt =
      new Date().toISOString();

    if (!fromMe) {
      existing.unreadCount += 1;
    }

    return res.json(existing);
  }

  // SI NO EXISTE
  const newConversation = {
    id: Date.now().toString(),

    customer: {
      name: name || phone,
      phone,
      avatar: "",
    },

    messages: [newMessage],

    lastMessage: newMessage,

    unreadCount: fromMe ? 0 : 1,

    status: "open",

    mode: "ai",

    priority: "medium",

    createdAt: new Date().toISOString(),

    updatedAt: new Date().toISOString(),

    lastActivity: new Date().toISOString(),
  };

  conversations.unshift(newConversation);

  res.json(newConversation);
});

module.exports = router;