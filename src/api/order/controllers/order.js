const { createCoreController } = require("@strapi/strapi").factories;
const crypto = require("crypto");
const axios = require("axios");

module.exports = createCoreController("api::order.order", ({ strapi }) => ({
  async wompiWebhook(ctx) {
    try {
      const payload = ctx.request.body;
      strapi.log.info(`[Wompi Webhook] Payload recibido: ${JSON.stringify(payload)}`);

      // 1. Validar la firma de Wompi
      const signature = payload.signature;
      if (!signature || !signature.properties || !signature.checksum) {
        strapi.log.warn("[Wompi Webhook] Payload de firma no recibido.");
        ctx.status = 400;
        ctx.body = { success: false, error: "Firma inválida." };
        return;
      }

      // Concatenar las propiedades en el orden exacto indicado en signature.properties
      let concatString = "";
      for (const prop of signature.properties) {
        const parts = prop.split(".");
        let val = payload.data;
        for (const part of parts) {
          val = val?.[part];
        }
        concatString += val;
      }
      concatString += payload.timestamp;
      
      // Event secret desde las variables de entorno
      const eventsSecret = process.env.WOMPI_EVENTS_SECRET || "wompi_events_secret_test";
      concatString += eventsSecret;

      // Calcular SHA256 hash
      const computedHash = crypto.createHash("sha256").update(concatString).digest("hex");

      if (computedHash !== signature.checksum) {
        strapi.log.error(
          `[Wompi Webhook] Firma inválida. Calculada: ${computedHash}, Recibida: ${signature.checksum}`
        );
        ctx.status = 400;
        ctx.body = { success: false, error: "Firma inválida." };
        return;
      }

      strapi.log.info("[Wompi Webhook] Firma validada con éxito.");

      // 2. Procesar el evento
      if (payload.event === "transaction.updated") {
        const transaction = payload.data.transaction;
        const reference = transaction.reference;
        const status = transaction.status; // APPROVED, DECLINED, ERROR, etc.

        strapi.log.info(
          `[Wompi Webhook] Transacción ${transaction.id} con referencia ${reference} tiene estado: ${status}`
        );

        // Buscar la orden correspondiente en la base de datos
        const order = await strapi.db.query("api::order.order").findOne({
          where: { wompi_reference: reference },
        });

        if (!order) {
          strapi.log.warn(
            `[Wompi Webhook] No se encontró ninguna orden con la referencia: ${reference}`
          );
          ctx.status = 200;
          ctx.body = { success: true, message: "Orden no encontrada." };
          return;
        }

        strapi.log.info(
          `[Wompi Webhook] Orden encontrada ID: ${order.id}. Estado de pago anterior: ${order.payment_status || "PENDING"} -> Nuevo: ${status}`
        );

        // Actualizar el estado de pago en la orden
        await strapi.documents("api::order.order").update({
          documentId: order.documentId,
          data: {
            payment_status: status,
          },
        });

        // Re-publicar para sincronizar draft y published
        await strapi.documents("api::order.order").publish({
          documentId: order.documentId,
        });

        strapi.log.info(`[Wompi Webhook] Orden ID ${order.id} actualizada y re-publicada.`);

        // Emitir evento por WebSockets para refrescar panel de administración en tiempo real
        if (strapi.io) {
          strapi.io.emit("order_payment_update", {
            orderId: order.id,
            documentId: order.documentId,
            paymentStatus: status,
          });
          strapi.log.info(`[Wompi Webhook] WebSocket emitido para orden ID: ${order.id}`);
        }

        // Si el estado es APPROVED y la orden se originó en WhatsApp, enviar un WhatsApp automático de confirmación al cliente
        if (status === "APPROVED" && order.source === "whatsapp" && order.whatsapp_id) {
          try {
            const phone_number_id = process.env.ID_PHONE_WS || "1037050959491352";
            const whatsapp_token = process.env.WHATSAPP_TOKEN;

            if (whatsapp_token) {
              strapi.log.info(`[Wompi Webhook] Enviando confirmación de pago por WhatsApp a ${order.whatsapp_id}`);
              await axios({
                method: "POST",
                url: `https://graph.facebook.com/v21.0/${phone_number_id}/messages`,
                data: {
                  messaging_product: "whatsapp",
                  to: order.whatsapp_id,
                  type: "text",
                  text: {
                    body: `¡Pago confirmado! 💳 Tu pago con Wompi ha sido aprobado con éxito. Tu pedido (Orden #${order.id}) está en preparación. ¡Muchas gracias por tu compra! 🥦`,
                  },
                },
                headers: {
                  Authorization: `Bearer ${whatsapp_token}`,
                  "Content-Type": "application/json",
                },
              });
              strapi.log.info(`[Wompi Webhook] Mensaje de confirmación de WhatsApp enviado con éxito.`);
            } else {
              strapi.log.warn("[Wompi Webhook] WHATSAPP_TOKEN no configurado. Se omite el envío del mensaje.");
            }
          } catch (wsErr) {
            strapi.log.error(
              `[Wompi Webhook] Error al enviar mensaje de WhatsApp: ${wsErr.response?.data ? JSON.stringify(wsErr.response.data) : wsErr.message}`
            );
          }
        }
      }

      ctx.status = 200;
      ctx.body = { success: true };
    } catch (err) {
      strapi.log.error(`[Wompi Webhook Error] ${err.message}`);
      ctx.status = 500;
      ctx.body = { success: false, error: err.message };
    }
  },
}));
