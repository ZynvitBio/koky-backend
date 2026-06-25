// @ts-nocheck
"use strict";
const axios = require("axios");
const qs = require("qs");

// URL BASE REAL
const API_BASE = "https://logistics.api.cabify.com/v1";

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
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });

      return { success: true, token: response.data.access_token };
    } catch (err) {
      return { success: false, error: err.response?.data || err.message };
    }
  },

  // 1. OBTENER TIPOS DISPONIBLES (Para saber qué ID enviar)
  async getShippingTypes(lat, lng) {
    const auth = await this.testConnection();
    const response = await axios.get(
      `${API_BASE}/shipping_types/available?location=${lat},${lng}`,
      {
        headers: { Authorization: `Bearer ${auth.token}` },
      },
    );
    return response.data; // Aquí eliges el ID que corresponde a "Express"
  },

  // 2. CREAR PAQUETE CON TARIFA (Aquí es donde la API responde con el precio)
  async createShipment(parcelData) {
    const auth = await this.testConnection();

    // parcelData DEBE incluir: { shipping_type_id: "...", ... }
    const payload = { parcels: [parcelData] };

    try {
      const response = await axios.post(`${API_BASE}/parcels`, payload, {
        headers: {
          Authorization: `Bearer ${auth.token}`,
          "Content-Type": "application/json",
        },
      });
      // Esta respuesta DEBERÍA traer el precio final consolidado
      return response.data;
    } catch (error) {
      throw new Error(JSON.stringify(error.response?.data || error.message));
    }
  },
  async testMyParcel() {
    const parcelId = "9e35184b-7015-11f1-bcdf-ae4d1e293208";
    const auth = await this.testConnection();

    const response = await axios.get(
      `https://logistics.api.cabify.com/v1/parcels/${parcelId}`,
      {
        headers: {
          Authorization: `Bearer ${auth.token}`,
          Accept: "application/json",
        },
      },
    );
    return response.data;
  },
  async getPriceEstimate(parcelData) {
    const auth = await this.testConnection();

    // Obtenemos coordenadas para buscar tipos disponibles
    const lat = parcelData.pickup_location.lat;
    const lon = parcelData.pickup_location.lon;

    // 1. Obtener tipos de envío
    const typesResponse = await axios.get(
      `https://logistics.api.cabify.com/v1/shipping_types/available?location=${lat},${lon}`,
      { headers: { Authorization: `Bearer ${auth.token}` } },
    );

    const shippingTypes = typesResponse.data.available_shipping_types;
    const expressType = shippingTypes
      ? shippingTypes.find((t) => t.modality === "express")
      : null;

    if (!expressType) {
      throw new Error(
        "No se encontró tipo 'express'. Respuesta: " +
          JSON.stringify(typesResponse.data),
      );
    }
    const futureTime = new Date(Date.now() + 30 * 60000).toISOString();
    // 2. Preparar el payload estrictamente como lo pide la API v3
    const payload = {
      parcels: [
        {
          external_id: parcelData.external_id || "parcel_001",
          pickup_location: {
            lat: parcelData.pickup_location.lat,
            lon: parcelData.pickup_location.lon,
          },
          dropoff_location: {
            lat: parcelData.dropoff_location.lat,
            lon: parcelData.dropoff_location.lon,
          },
          dimensions: parcelData.dimensions,
          weight: parcelData.weight,
        },
      ],
      shipping_type_id: expressType.id,
      // Si la API lo requiere, puedes añadir el pickup_time aquí:
      pickup_time: futureTime,
    };
    console.log("PAYLOAD FINAL ENVIADO A CABIFY:", JSON.stringify(payload));
    // 3. Ejecutar estimación con el detector de errores que querías
    try {
      const response = await axios.post(
        `https://logistics.api.cabify.com/v3/parcels/estimate`,
        payload,
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
      if (error.response) {
        // Aquí capturamos el JSON real del error de Cabify
        const detailedError = JSON.stringify(error.response.data);
        console.error("Error detallado de Cabify:", detailedError);
        throw new Error(detailedError);
      } else {
        throw new Error(error.message);
      }
    }
  },
};
