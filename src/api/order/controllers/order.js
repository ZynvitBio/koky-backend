const { createCoreController } = require("@strapi/strapi").factories;
const crypto = require("crypto");
const axios = require("axios");

function getDeliverySchedule(date) {
  // Configurar formateador para la zona horaria de Bogotá (UTC-5)
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hour12: false
  });
  
  const parts = formatter.formatToParts(date);
  const getVal = (type) => parseInt(parts.find(p => p.type === type).value, 10);
  
  const year = getVal("year");
  const month = getVal("month") - 1; // JS months are 0-11
  const day = getVal("day");
  const hour = getVal("hour");
  
  // Objeto Date en la zona horaria de Colombia
  const colDate = new Date(year, month, day);
  const dayOfWeek = colDate.getDay(); // 0 = Domingo, 1 = Lunes, ..., 6 = Sábado

  let productionNight = "";
  let deliveryDay = "";

  if (dayOfWeek >= 1 && dayOfWeek <= 3) { // Lunes, Martes, Miércoles
    if (hour < 16) { // Antes de las 4:00 PM
      const days = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
      productionNight = "esta misma noche";
      deliveryDay = `mañana mismo (${days[dayOfWeek + 1]})`;
    } else { // Después de las 4:00 PM
      const days = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];
      productionNight = "mañana por la noche";
      deliveryDay = `pasado mañana (${days[dayOfWeek + 2]})`;
    }
  } else if (dayOfWeek === 4) { // Jueves
    if (hour < 16) { // Antes de las 4:00 PM
      productionNight = "esta misma noche";
      deliveryDay = "mañana mismo (viernes)";
    } else { // Después de las 4:00 PM
      productionNight = "el domingo por la noche";
      deliveryDay = "el próximo lunes";
    }
  } else if (dayOfWeek === 5 || dayOfWeek === 6) { // Viernes o Sábado
    productionNight = "el domingo por la noche";
    deliveryDay = "el próximo lunes";
  } else if (dayOfWeek === 0) { // Domingo
    if (hour < 16) { // Antes de las 4:00 PM
      productionNight = "esta misma noche";
      deliveryDay = "mañana mismo (lunes)";
    } else { // Después de las 4:00 PM
      productionNight = "mañana por la noche";
      deliveryDay = "el próximo martes";
    }
  }

  return { productionNight, deliveryDay };
}

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
              strapi.log.info(`[Wompi Webhook] Generando factura PDF para la orden #${order.id}...`);
              let pdfUrl = null;
              let mediaId = null;
              try {
                // Volvemos a obtener el objeto orden completo para tener los datos más recientes
                const fullOrder = await strapi.entityService.findOne("api::order.order", order.id);
                const pdfResult = await strapi.service("api::order.order").generateInvoicePDF(fullOrder, {
                  phone_number_id,
                  whatsapp_token
                });
                pdfUrl = pdfResult.url;
                mediaId = pdfResult.mediaId;
                strapi.log.info(`[Wompi Webhook] Factura PDF generada con éxito: ${pdfUrl} | Media ID: ${mediaId}`);
              } catch (pdfErr) {
                strapi.log.error(`[Wompi Webhook] Error al generar factura PDF: ${pdfErr.message}`);
              }

              const { productionNight, deliveryDay } = getDeliverySchedule(new Date());

              strapi.log.info(`[Wompi Webhook] Enviando confirmación de pago por WhatsApp a ${order.whatsapp_id}`);
              await axios({
                method: "POST",
                url: `https://graph.facebook.com/v21.0/${phone_number_id}/messages`,
                data: {
                  messaging_product: "whatsapp",
                  to: order.whatsapp_id,
                  type: "text",
                  text: {
                    body: `¡Pago confirmado! 💳\n\nTu pago con Wompi ha sido aprobado con éxito. Tu pedido (Orden #${order.id}) entrará a nuestra cocina ${productionNight} para prepararse con ingredientes frescos, y te lo entregaremos ${deliveryDay}. Te avisaremos por este medio en cuanto tu pedido esté en camino con el repartidor. 🛵\n\n¡Muchas gracias por tu compra! 🥦`,
                  },
                },
                headers: {
                  Authorization: `Bearer ${whatsapp_token}`,
                  "Content-Type": "application/json",
                },
              });

              // Si se pudo generar el PDF (URL o Media ID), enviarlo como documento adjunto
              if (pdfUrl || mediaId) {
                strapi.log.info(`[Wompi Webhook] Enviando archivo PDF de factura a ${order.whatsapp_id} (usando ${mediaId ? 'Media ID: ' + mediaId : 'Link: ' + pdfUrl})`);
                
                const docPayload = {
                  messaging_product: "whatsapp",
                  to: order.whatsapp_id,
                  type: "document",
                  document: {
                    filename: `Factura_Koky_${order.id}.pdf`
                  }
                };

                if (mediaId) {
                  docPayload.document.id = mediaId;
                } else {
                  docPayload.document.link = pdfUrl;
                }

                await axios({
                  method: "POST",
                  url: `https://graph.facebook.com/v21.0/${phone_number_id}/messages`,
                  data: docPayload,
                  headers: {
                    Authorization: `Bearer ${whatsapp_token}`,
                    "Content-Type": "application/json",
                  },
                });
                strapi.log.info(`[Wompi Webhook] Factura PDF enviada por WhatsApp con éxito.`);
              }
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

  async getConfirmationDetails(ctx) {
    try {
      const { reference } = ctx.params;
      if (!reference) {
        return ctx.badRequest("Referencia no recibida.");
      }

      const order = await strapi.db.query("api::order.order").findOne({
        where: { wompi_reference: reference },
        populate: { invoice_pdf: true },
      });

      if (!order) {
        return ctx.notFound("Orden no encontrada.");
      }

      const { productionNight, deliveryDay } = getDeliverySchedule(order.createdAt || new Date());

      return ctx.send({
        id: order.id,
        payment_status: order.payment_status,
        invoice_pdf_url: order.invoice_pdf ? order.invoice_pdf.url : null,
        production_night: productionNight,
        delivery_day: deliveryDay,
      });
    } catch (err) {
      return ctx.internalServerError(err.message);
    }
  },

  async generateWompiSignature(ctx) {
    try {
      const { reference, amountInCents, currency } = ctx.request.body;
      if (!reference || !amountInCents || !currency) {
        return ctx.badRequest("Faltan parámetros requeridos (reference, amountInCents, currency)");
      }

      const integrityKey = process.env.wompiIntegrityKey || process.env.WOMPI_INTEGRITY_KEY;
      if (!integrityKey) {
        return ctx.internalServerError("Llave de integridad no configurada en el servidor.");
      }

      const concatString = `${reference}${amountInCents}${currency}${integrityKey}`;
      const computedHash = crypto.createHash("sha256").update(concatString).digest("hex");

      return ctx.send({ signature: computedHash });
    } catch (err) {
      return ctx.internalServerError(err.message);
    }
  },
}));
