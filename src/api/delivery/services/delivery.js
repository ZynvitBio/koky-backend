// @ts-nocheck
"use strict";
const axios = require("axios");

module.exports = {
  async testConnection() {
    try {
      // Usamos la URL que SÍ respondió (cabify.com) pero cambiamos el formato de envío
      // A veces, aunque la doc diga body, requieren que se pase como parámetros de URL
      const url = `https://cabify.com/auth/api/authorization?grant_type=client_credentials&client_id=${process.env.CABIFY_CLIENT_ID}&client_secret=${process.env.CABIFY_CLIENT_SECRET}`;

      const response = await axios.post(url);

      return {
        success: true,
        message: "¡Hermes conectado!",
        token: response.data.access_token.substring(0, 8) + "...",
      };
    } catch (err) {
      return {
        success: false,
        error: err.response?.data || err.message,
        tried: "https://cabify.com/auth/api/authorization",
      };
    }
  },
};
