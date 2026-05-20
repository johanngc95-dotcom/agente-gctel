const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const router = express.Router();

/*
USUARIOS TEMPORALES EN MEMORIA
Luego los conectaremos a base de datos
*/
const users = [];

router.post("/register", async (req, res) => {
  try {
    const { name, email, password } = req.body;

    const existingUser = users.find(
      (u) => u.email === email
    );

    if (existingUser) {
      return res.status(400).json({
        error: "El usuario ya existe",
      });
    }

    const hashedPassword = await bcrypt.hash(
      password,
      10
    );

    const user = {
      id: Date.now().toString(),
      name,
      email,
      password: hashedPassword,
      role: "admin",
    };

    users.push(user);

    res.json({
      success: true,
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

router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = users.find(
      (u) => u.email === email
    );

    if (!user) {
      return res.status(401).json({
        error: "Usuario no encontrado",
      });
    }

    const validPassword = await bcrypt.compare(
      password,
      user.password
    );

    if (!validPassword) {
      return res.status(401).json({
        error: "Contraseña incorrecta",
      });
    }

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