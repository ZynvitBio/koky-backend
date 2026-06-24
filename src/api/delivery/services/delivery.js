// @ts-nocheck
"use strict";
const axios = require("axios");
const qs = require("qs");

module.exports = {
  async testConnection() {
    try {
      const url = "https://cabify.com/auth/api/authorization";
      const data = {
        grant_type: "client_credentials",
        client_id: process.env.CABIFY_CLIENT_ID,
        client_secret: process.env.CABIFY_CLIENT_SECRET,
      };

      const response = await axios({
        method: "post",
        url: url,
        data: qs.stringify(data),
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      });

      return {
        success: true,
        message: "¡Conectado exitosamente!",
        token: response.data.access_token, // Guardamos el token completo aquí
      };
    } catch (err) {
      return {
        success: false,
        error: err.response?.data || err.message,
        tried: "https://cabify.com/auth/api/authorization",
      };
    }
  },

  async createShipment(parcelData) {
    const auth = await this.testConnection();
    if (!auth.success) throw new Error("No se pudo autenticar con Cabify");

    try {
      const response = await axios.post(
        "https://logistics.api.cabify.com/v1/shipments",
        parcelData,
        {
          headers: {
            Authorization: `Bearer ${auth.token}`,
            "Content-Type": "application/json",
          },
        },
      );
      return response.data;
    } catch (error) {
      // Esto capturará el detalle del error (404, 400, etc.)
      const errorMsg = error.response
        ? JSON.stringify(error.response.data)
        : error.message;
      console.error("Error detallado de Cabify:", errorMsg);
      throw new Error(errorMsg);
    }
  },

  async testCreateShipment() {
    const mockParcel = {
      shipment: {
        pickup_address: "Calle 93 # 12-10, Bogotá",
        dropoff_address: "Carrera 15 # 90-20, Bogotá",
        contact_name: "Cliente de Prueba",
        contact_phone: "+573000000000",
      },
    };

    try {
      const result = await this.createShipment(mockParcel);
      return { success: true, data: result };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },
};
