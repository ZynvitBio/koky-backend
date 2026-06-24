// @ts-nocheck
"use strict";
const axios = require("axios");

module.exports = {
  async testConnection() {
    try {
      // Según la doc: https://cabify.com/auth/api/authorization
      const response = await axios.post(
        "https://cabify.com/auth/api/authorization",
        "grant_type=client_credentials&client_id=" +
          process.env.CABIFY_CLIENT_ID +
          "&client_secret=" +
          process.env.CABIFY_CLIENT_SECRET,
        {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
        },
      );

      return {
        success: true,
        message: "¡Hermes conectado con éxito!",
        token: response.data.access_token.substring(0, 10) + "...",
      };
    } catch (err) {
      return {
        success: false,
        error: err.response?.data || err.message,
        url_used: "https://cabify.com/auth/api/authorization",
      };
    }
  },
};
