// @ts-nocheck
"use strict";
const axios = require("axios");

module.exports = {
  async testConnection() {
    try {
      // Usamos el dominio correcto para Logística
      const url = "https://logistics.api.cabify.com/v1/oauth/token";

      // Enviamos como Basic Auth, que es el estándar para OAuth2 cuando el client_id/secret es inválido en el body
      const credentials = Buffer.from(
        `${process.env.CABIFY_CLIENT_ID}:${process.env.CABIFY_CLIENT_SECRET}`,
      ).toString("base64");

      const response = await axios.post(url, "grant_type=client_credentials", {
        headers: {
          Authorization: `Basic ${credentials}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      });

      return {
        success: true,
        message: "¡Hermes conectado con éxito!",
        token: response.data.access_token.substring(0, 10) + "...",
      };
    } catch (err) {
      return {
        success: false,
        error: err.response?.data || err.message,
        url_used: "https://logistics.api.cabify.com/v1/oauth/token",
      };
    }
  },
};
