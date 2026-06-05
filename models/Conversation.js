const mongoose = require("mongoose");

const MessageSchema = new mongoose.Schema({
  sender_type: String,
  content: String,
  timestamp: {
    type: Date,
    default: Date.now
  }
});

const ConversationSchema = new mongoose.Schema({
  phone: {
    type: String,
    required: true,
    unique: true
  },

  name: {
    type: String,
    default: ""
  },

  mode: {
    type: String,
    default: "ai"
  },

  status: {
    type: String,
    default: "open"
  },

  assigned_agent: {
    type: String,
    default: null
  },

  messages: [MessageSchema],

  memory: {
    nombre: String,
    negocio: String,
    servicioInteres: String,
    presupuesto: String,
    intencionDetectada: String,

    objeciones: [String],

    leadCaliente: {
      type: Boolean,
      default: false
    }
  },

  salesStage: {
    type: String,
    default: "nuevo"
  },

  leadScore: {
    type: Number,
    default: 0
  },

  priority: {
    type: String,
    default: "low"
  },

  needsHuman: {
    type: Boolean,
    default: false
  }

}, {
  timestamps: true
});

module.exports =
  mongoose.model(
    "Conversation",
    ConversationSchema
  );