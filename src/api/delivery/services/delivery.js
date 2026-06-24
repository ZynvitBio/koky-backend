// @ts-nocheck
"use strict";
const axios = require("axios");

module.exports = {
  async testConnection() {
    try {
      // Usamos el endpoint indicado en la documentación oficial
      const url = "https://cabify.com/auth/api/authorization";

      // Construimos el encabezado de autenticación Basic
      const auth = Buffer.from(
        `${process.env.CABIFY_CLIENT_ID}:${process.env.CABIFY_CLIENT_SECRET}`,
      ).toString("base64");

      const response = await axios.post(url, "grant_type=client_credentials", {
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      });

      return {
        success: true,
        message: "¡Hermes conectado con éxito!",
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
