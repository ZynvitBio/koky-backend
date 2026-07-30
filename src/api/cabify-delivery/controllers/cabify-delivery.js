// @ts-nocheck
"use strict";

module.exports = {
  /**
   * Obtiene la estimación de precio para un envío de Cabify.
   * Recibe el destino desde el frontend (Angular).
   */
  async getPrice(ctx) {
    try {
      const { destino } = ctx.request.body;

      if (!destino || !destino.lat || !destino.lng) {
        throw new Error("Coordenadas de destino no recibidas correctamente.");
      }

      // Preparamos el objeto usando el destino dinámico
      const parcelData = {
        pickup_location: { lat: 4.6976, lon: -74.0617 }, // Ubicación fija de Koky Kitchen
        dropoff_location: { lat: destino.lat, lon: destino.lng },
        dimensions: { height: 10, length: 10, width: 10, unit: "cm" },
        weight: { value: 1000, unit: "g" },
      };

      // Llamamos al servicio centralizado
      const resultado = await strapi
        .service("api::cabify-delivery.cabify-delivery")
        .getPriceEstimate(parcelData);

      ctx.body = { success: true, data: resultado };
    } catch (err) {
      ctx.status = 500;
      ctx.body = { success: false, error: err.message };
    }
  },

  async createParcel(ctx) {
    try {
      const { deliveryData } = ctx.request.body;

      if (
        !deliveryData ||
        !deliveryData.dropoff_address ||
        !deliveryData.dropoff_location ||
        !deliveryData.customer_name ||
        !deliveryData.customer_phone
      ) {
        throw new Error("Datos de entrega incompletos.");
      }

      const resultado = await strapi
        .service("api::cabify-delivery.cabify-delivery")
        .createAndDeliverParcel(deliveryData);

      ctx.body = { success: true, data: resultado };
    } catch (err) {
      ctx.status = 500;
      ctx.body = { success: false, error: err.message };
    }
  },

  async cancelParcel(ctx) {
    try {
      const { parcelId, documentId } = ctx.request.body;

      if (!parcelId) {
        throw new Error("ID de paquete no recibido.");
      }

      let resultado = null;
      let cabifyError = null;

      try {
        // 1. Cancelar en Cabify
        resultado = await strapi
          .service("api::cabify-delivery.cabify-delivery")
          .cancelParcel(parcelId);
      } catch (err) {
        cabifyError = err.message;
        strapi.log.warn(`[Cabify Cancel] No se pudo cancelar en la API de Cabify: ${err.message}`);

        // Si el error es un 409 (ya cancelado/entregado) o 404 (no existe), permitimos
        // continuar para limpiar la base de datos y liberar la orden en el admin.
        const isSafeToIgnore =
          err.message.includes("409") ||
          err.message.includes("404") ||
          err.message.includes("invalid state");

        if (!isSafeToIgnore) {
          // Si es otro tipo de error (ej: red, 401), lanzamos el error para no perder la traza
          throw err;
        }
      }

      // 2. Si se pasó documentId, actualizar la orden en Strapi para quitar el ID de Cabify
      if (documentId) {
        await strapi.documents("api::order.order").update({
          documentId: documentId,
          data: {
            cabify_parcel_id: null,
          },
        });
        await strapi.documents("api::order.order").publish({
          documentId: documentId,
        });
      }

      ctx.body = { 
        success: true, 
        data: resultado, 
        warning: cabifyError ? `El envío ya estaba cancelado en Cabify o no se encontró (${cabifyError})` : null 
      };
    } catch (err) {
      ctx.status = 500;
      ctx.body = { success: false, error: err.message };
    }
  },

  async getParcelStatus(ctx) {
    try {
      const { parcelId } = ctx.params;

      if (!parcelId) {
        throw new Error("ID de paquete no recibido.");
      }

      const resultado = await strapi
        .service("api::cabify-delivery.cabify-delivery")
        .getParcelStatus(parcelId);

      ctx.body = { success: true, data: resultado };
    } catch (err) {
      ctx.status = 500;
      ctx.body = { success: false, error: err.message };
    }
  },

  async webhook(ctx) {
    try {
      const payload = ctx.request.body;
      strapi.log.info(`[Cabify Webhook] Recibido payload: ${JSON.stringify(payload)}`);

      // Extraemos el parcel_id buscando en los campos comunes
      const parcelId = payload.parcel_id || payload.parcelId || payload.id || payload.data?.parcel_id || payload.data?.id;

      if (!parcelId) {
        strapi.log.warn('[Cabify Webhook] No se encontró parcel_id en el payload.');
        ctx.status = 200;
        ctx.body = { success: false, message: 'No parcel_id found' };
        return;
      }

      // Consultamos el estado fresco a la API de Cabify
      const statusData = await strapi
        .service("api::cabify-delivery.cabify-delivery")
        .getParcelStatus(parcelId);

      // Actualizamos automáticamente la orden en Strapi si la encontramos por parcelId
      try {
        const matchingOrder = await strapi.db.query("api::order.order").findOne({
          where: { cabify_parcel_id: parcelId }
        });

        if (matchingOrder) {
          let newOrderStatus = matchingOrder.order_status;
          let newShippingNotes = matchingOrder.shipping_notes;
          const cabifyState = String(statusData?.status || statusData?.state || statusData?.data?.status || '').toUpperCase();

          if (['IN_TRANSIT', 'ACCEPTED', 'ASSIGNED', 'PICKED_UP', 'SHIPPED'].some(s => cabifyState.includes(s))) {
            newOrderStatus = 'SHIPPED';
            newShippingNotes = 'Despachado en camino por Cabify Express';
          } else if (['DELIVERED', 'COMPLETED'].some(s => cabifyState.includes(s))) {
            newOrderStatus = 'DELIVERED';
            newShippingNotes = 'Entregado al cliente por Cabify Express';
          }

          if (newOrderStatus !== matchingOrder.order_status) {
            await strapi.documents("api::order.order").update({
              documentId: matchingOrder.documentId,
              data: {
                order_status: newOrderStatus,
                shipping_notes: newShippingNotes
              }
            });
            await strapi.documents("api::order.order").publish({
              documentId: matchingOrder.documentId
            });
            strapi.log.info(`[Cabify Webhook] Orden #${matchingOrder.id} actualizada a order_status: ${newOrderStatus}`);
          }
        }
      } catch (orderUpdateErr) {
        strapi.log.error(`[Cabify Webhook] Error actualizando orden en Strapi: ${orderUpdateErr.message}`);
      }

      // Emitimos el evento de Socket.io a todos los clientes del dashboard conectados
      if (strapi.io) {
        strapi.io.emit('cabify_status_change', {
          parcelId,
          status: statusData
        });
        strapi.log.info(`[Cabify Webhook] Evento de socket emitido para parcelId: ${parcelId}`);
      }

      ctx.status = 200;
      ctx.body = { success: true };
    } catch (err) {
      strapi.log.error(`[Cabify Webhook] Error: ${err.message}`);
      ctx.status = 200; // Siempre respondemos 200 para evitar reintentos infinitos de Cabify en caso de error lógico
      ctx.body = { success: false, error: err.message };
    }
  },

  async registerWebhook(ctx) {
    try {
      const { secret } = ctx.query;
      if (!secret || secret !== process.env.JWT_SECRET) {
        ctx.status = 403;
        ctx.body = { success: false, error: "No autorizado." };
        return;
      }

      const callbackUrl = "https://koky-backend-production.up.railway.app/api/cabify-delivery/webhook";
      const resultado = await strapi
        .service("api::cabify-delivery.cabify-delivery")
        .registerWebhook(callbackUrl);

      ctx.body = { success: true, data: resultado };
    } catch (err) {
      ctx.status = 500;
      ctx.body = { success: false, error: err.message };
    }
  },
};
