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

    // Ajustamos parcelData para envolverlo en la estructura { parcels: [...] } que pide la API
    const payload = {
      parcels: [parcelData],
    };

    try {
      const response = await axios.post(
        "https://logistics.api.cabify-sandbox.com/v1/parcels",
        payload, // Enviamos el objeto con el array
        {
          headers: {
            Authorization: `Bearer ${auth.token}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
        },
      );
      return response.data;
    } catch (error) {
      // El error ahora será mucho más preciso gracias a la validación de la API
      throw new Error(JSON.stringify(error.response?.data || error.message));
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
  async getEstimate(estimateData) {
    // Probamos la combinación del subdominio correcto con el endpoint de estimación
    const url = "https://logistics.api.cabify-sandbox.com/v1/estimates";

    const auth = await this.testConnection();
    if (!auth.success) throw new Error("No se pudo autenticar");

    try {
      const response = await axios.post(url, estimateData, {
        headers: {
          Authorization: `Bearer ${auth.token}`,
          "Content-Type": "application/json",
        },
      });
      return response.data;
    } catch (error) {
      // Si sigue dando 404, significa que el endpoint es diferente.
      throw new Error(JSON.stringify(error.response?.data || error.message));
    }
  },
};
