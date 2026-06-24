// @ts-nocheck
"use strict";

const axios = require("axios");

module.exports = {
  async testConnection() {
    try {
      // Intentamos obtener el token
      const response = await axios.post(
        "https://api.cabify.com/v1/oauth/token",
        {
          grant_type: "client_credentials",
          client_id: process.env.CABIFY_CLIENT_ID,
          client_secret: process.env.CABIFY_CLIENT_SECRET,
        },
      );

      return {
        success: true,
        message: "Autenticación exitosa",
        // Esto nos confirmará qué entorno estamos tocando según la configuración
        env_used: process.env.CABIFY_ENV || "No definida",
        token_preview: response.data.access_token.substring(0, 5) + "...",
      };
    } catch (err) {
      return {
        success: false,
        error: err.response?.data?.message || err.message,
        tried_env: process.env.CABIFY_ENV, // Ver qué intentó usar
      };
    }
  },
};
