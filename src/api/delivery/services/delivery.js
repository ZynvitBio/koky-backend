// @ts-nocheck
"use strict";

const axios = require("axios");

module.exports = {
  // Función para obtener el token
  async getToken() {
    try {
      const response = await axios.post(
        "https://api.cabify.com/v1/oauth/token",
        {
          grant_type: "client_credentials",
          client_id: process.env.CABIFY_CLIENT_ID,
          client_secret: process.env.CABIFY_CLIENT_SECRET,
        },
      );
      return response.data.access_token;
    } catch (err) {
      throw new Error(
        "Error autenticando con Cabify: " +
          (err.response?.data?.message || err.message),
      );
    }
  },

  // Función de test que usa el token
  async testConnection() {
    const token = await this.getToken();
    return { success: true, tokenPreview: token.substring(0, 10) + "..." };
  },
};
