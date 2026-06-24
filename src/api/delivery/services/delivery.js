// @ts-nocheck
"use strict";
const axios = require("axios");

module.exports = {
  async testConnection() {
    try {
      const response = await axios({
        method: "post",
        url: "https://api.cabify.com/v1/oauth/token",
        headers: {
          "Content-Type": "application/json",
        },
        data: {
          grant_type: "client_credentials",
          client_id: process.env.CABIFY_CLIENT_ID,
          client_secret: process.env.CABIFY_CLIENT_SECRET,
        },
      });

      return {
        success: true,
        message: "Conexión exitosa",
        token: response.data.access_token.substring(0, 8) + "...",
      };
    } catch (err) {
      return {
        success: false,
        error: err.response?.data || err.message,
      };
    }
  },
};
