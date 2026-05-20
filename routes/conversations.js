const express = require("express");

const router = express.Router();

router.get("/", (req, res) => {

  if (!global.crmConversations) {
    global.crmConversations = [];
  }

  res.json(global.crmConversations);

});

module.exports = router;