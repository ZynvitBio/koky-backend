// @ts-nocheck
"use strict";
const axios = require("axios");
const qs = require("qs"); // Asegúrate de tener instalado qs: npm install qs

module.exports = {
  async testConnection() {
    try {
      // URL de producción según la documentación
      const url = "https://cabify.com/auth/api/authorization";

      // La documentación exige este formato específico en el cuerpo de la petición
      const data = {
        grant_type: "client_credentials",
        client_id: process.env.CABIFY_CLIENT_ID,
        client_secret: process.env.CABIFY_CLIENT_SECRET,
      };

      const response = await axios({
        method: "post",
        url: url,
        data: qs.stringify(data), // Convierte el objeto a "key=value&key=value"
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      });

      return {
        success: true,
        message: "¡Conectado exitosamente!",
        token: response.data.access_token.substring(0, 10) + "...",
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
