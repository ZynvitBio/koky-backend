// @ts-nocheck
"use strict";
const axios = require("axios");

module.exports = {
  async testConnection() {
    try {
      const response = await axios.post(
        "https://api.cabify.com/v1/oauth/token",
        {
          grant_type: "client_credentials",
          client_id: process.env.CABIFY_CLIENT_ID,
          client_secret: process.env.CABIFY_CLIENT_SECRET,
        },
      );
      return { success: true, token: !!response.data.access_token };
    } catch (e) {
      // Ahora el editor ignorará cualquier validación de tipos aquí
      const err = e;

      let message = "Error desconocido";
      if (err && err.response && err.response.data) {
        message = JSON.stringify(err.response.data);
      } else if (err && err.message) {
        message = err.message;
      }

      console.error("Error de conexión Cabify:", message);
      return { success: false, error: message };
    }
  },
};
