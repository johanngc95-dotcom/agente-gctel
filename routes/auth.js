const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const router = express.Router();

// ================= LOGIN =================

router.post("/login", async (req, res) => {
  try {

    const { email, password } = req.body;

    // USUARIO FIJO
    const user = {
      id: "1",
      name: "Johan",
      email: "jgonzalezc@gctel.mx",
      password: await bcrypt.hash("123456", 10),
      role: "admin",
    };

    // VALIDAR EMAIL
    if (email !== user.email) {
      return res.status(401).json({
        error: "Usuario no encontrado",
      });
    }

    // VALIDAR PASSWORD
    const validPassword =
      await bcrypt.compare(
        password,
        user.password
      );

    if (!validPassword) {
      return res.status(401).json({
        error: "Contraseña incorrecta",
      });
    }

    // TOKENS
    const accessToken = jwt.sign(
      {
        id: user.id,
        role: user.role,
      },
      "GCTEL_SECRET",
      {
        expiresIn: "7d",
      }
    );

    const refreshToken = jwt.sign(
      {
        id: user.id,
      },
      "GCTEL_REFRESH_SECRET",
      {
        expiresIn: "30d",
      }
    );

    res.json({
      accessToken,
      refreshToken,

      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });

  } catch (error) {

    console.error(error);

    res.status(500).json({
      error: "Error interno del servidor",
    });
  }
});

module.exports = router;