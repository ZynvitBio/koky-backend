const { createCoreController } = require("@strapi/strapi").factories;
const crypto = require("crypto");
const axios = require("axios");
const { getDeliverySchedule } = require("../../../utils/delivery-helper");

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

        // Extraer email de la transacción de Wompi o de la orden
        const customerEmail = transaction?.customer_email || order.customer_email;

        // Actualizar el estado de pago y el correo en la orden si no lo tenía
        const updateData = {
          payment_status: status,
        };
        if (customerEmail && !order.customer_email) {
          updateData.customer_email = customerEmail;
        }

        await strapi.documents("api::order.order").update({
          documentId: order.documentId,
          data: updateData,
        });

        // Re-publicar para sincronizar draft y published
        await strapi.documents("api::order.order").publish({
          documentId: order.documentId,
        });

        // Obtenemos el documento oficial publicado para asegurar el ID definitivo
        let finalOrder = order;
        try {
          const pubDoc = await strapi.documents("api::order.order").findOne({
            documentId: order.documentId,
          });
          if (pubDoc) finalOrder = pubDoc;
        } catch (pubErr) {}

        strapi.log.info(`[Wompi Webhook] Orden ID ${finalOrder.id} actualizada y re-publicada.`);

        // Emitir evento por WebSockets para refrescar panel de administración en tiempo real
        if (strapi.io) {
          strapi.io.emit("order_payment_update", {
            orderId: finalOrder.id,
            documentId: finalOrder.documentId,
            paymentStatus: status,
          });
          strapi.log.info(`[Wompi Webhook] WebSocket emitido para orden ID: ${finalOrder.id}`);
        }

        // Si el estado es APPROVED, generar factura y despachar por Email y/o WhatsApp
        if (status === "APPROVED") {
          let pdfUrl = null;
          let mediaId = null;
          const phone_number_id = process.env.ID_PHONE_WS || "1037050959491352";
          const whatsapp_token = process.env.WHATSAPP_TOKEN;

          // 1. Generar factura PDF para TODA orden aprobada (Web o WhatsApp)
          try {
            strapi.log.info(`[Wompi Webhook] Generando factura PDF para la orden #${finalOrder.id}...`);
            const fullOrder = await strapi.entityService.findOne("api::order.order", finalOrder.id, {
              populate: ["invoice_pdf"]
            });
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

          // 2. Enviar Factura por Email (Resend) si hay email disponible
          const targetEmail = customerEmail || finalOrder.customer_email;
          if (targetEmail) {
            try {
              strapi.log.info(`[Wompi Webhook] Enviando factura por email a ${targetEmail}...`);
              const fullOrderForEmail = await strapi.entityService.findOne("api::order.order", finalOrder.id);
              await strapi.service("api::order.order").sendInvoiceEmail(fullOrderForEmail, pdfUrl, {
                recipientEmail: targetEmail
              });
              strapi.log.info(`[Wompi Webhook] Factura por email enviada exitosamente a ${targetEmail}`);
            } catch (emailErr) {
              strapi.log.error(`[Wompi Webhook] Error al enviar email de factura: ${emailErr.message}`);
            }
          }

          // 3. Si la orden tiene WhatsApp registrado, enviar confirmación y PDF por WhatsApp
          if (finalOrder.whatsapp_id && whatsapp_token) {
            try {
              const { productionNight, deliveryDay } = getDeliverySchedule(new Date());

              strapi.log.info(`[Wompi Webhook] Enviando confirmación de pago por WhatsApp a ${finalOrder.whatsapp_id}`);
              const targetOrderWA = String(finalOrder.whatsapp_id).trim();
              const isBSUIDOrder = /^[a-zA-Z]{2}\./.test(targetOrderWA);

              const textPayload = {
                messaging_product: "whatsapp",
                type: "text",
                text: {
                  body: `¡Pago confirmado! 💳\n\nTu pago con Wompi ha sido aprobado con éxito. Tu pedido (Orden #${finalOrder.id}) entrará a nuestra cocina ${productionNight} para prepararse con ingredientes frescos, y te lo entregaremos ${deliveryDay}. Te avisaremos por este medio en cuanto tu pedido esté en camino con el repartidor. 🛵\n\n¡Muchas gracias por tu compra! 🥦`,
                },
              };

              if (isBSUIDOrder) {
                textPayload.recipient = targetOrderWA;
              } else {
                textPayload.to = targetOrderWA.replace(/\D/g, '');
              }

              await axios({
                method: "POST",
                url: `https://graph.facebook.com/v21.0/${phone_number_id}/messages`,
                data: textPayload,
                headers: {
                  Authorization: `Bearer ${whatsapp_token}`,
                  "Content-Type": "application/json",
                },
              });

              // Si se pudo generar el PDF (URL o Media ID), enviarlo como documento adjunto
              if (pdfUrl || mediaId) {
                strapi.log.info(`[Wompi Webhook] Enviando archivo PDF de factura a ${finalOrder.whatsapp_id} (usando ${mediaId ? 'Media ID: ' + mediaId : 'Link: ' + pdfUrl})`);
                
                const docPayload = {
                  messaging_product: "whatsapp",
                  type: "document",
                  document: {
                    filename: `Factura_Koky_${finalOrder.id}.pdf`
                  }
                };

                if (isBSUIDOrder) {
                  docPayload.recipient = targetOrderWA;
                } else {
                  docPayload.to = targetOrderWA.replace(/\D/g, '');
                }

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
            } catch (wsErr) {
              strapi.log.error(
                `[Wompi Webhook] Error al enviar mensaje de WhatsApp: ${wsErr.response?.data ? JSON.stringify(wsErr.response.data) : wsErr.message}`
              );
            }
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
        orderBy: { id: "desc" },
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

  async getPaymentLinkByReference(ctx) {
    try {
      const { reference } = ctx.params;
      if (!reference) {
        return ctx.badRequest("Referencia no recibida.");
      }

      const order = await strapi.db.query("api::order.order").findOne({
        where: { wompi_reference: reference },
        orderBy: { id: "desc" },
      });

      if (!order) {
        return ctx.notFound("Orden no encontrada.");
      }

      const totalAmount = Number(order.total_amount) || 0;
      const amountInCents = Math.round(totalAmount * 100);
      const currency = "COP";
      const publicKey = process.env.WOMPI_PUBLIC_KEY || "pub_prod_fiQqn8TiiKqVLDEsmrL5LD2LSiau8xmz";
      const integrityKey = process.env.wompiIntegrityKey || process.env.WOMPI_INTEGRITY_KEY;

      let signatureHex = "";
      if (integrityKey) {
        const concatString = `${reference}${amountInCents}${currency}${integrityKey}`;
        signatureHex = crypto.createHash("sha256").update(concatString).digest("hex");
      }

      const redirectUrl = encodeURIComponent("https://wa.me/573019447660");
      const paymentUrl = `https://checkout.wompi.co/p/?public-key=${publicKey}&currency=${currency}&amount-in-cents=${amountInCents}&reference=${reference}${signatureHex ? `&signature:integrity=${signatureHex}` : ""}&redirect-url=${redirectUrl}`;

      return ctx.send({
        success: true,
        reference,
        orderId: order.id,
        total_amount: totalAmount,
        payment_status: order.payment_status,
        payment_url: paymentUrl
      });
    } catch (err) {
      return ctx.internalServerError(err.message);
    }
  },

  async sendInvoiceEmailManually(ctx) {
    try {
      const { id } = ctx.params;
      const { email } = ctx.request.body || {};

      if (!id) {
        return ctx.badRequest("Identificador de orden no proporcionado.");
      }

      // Buscar por ID numérico o documentId
      let order = null;
      if (/^\d+$/.test(id)) {
        order = await strapi.entityService.findOne("api::order.order", parseInt(id, 10), {
          populate: ["invoice_pdf"]
        });
      } else {
        const found = await strapi.db.query("api::order.order").findOne({
          where: { documentId: id },
          populate: ["invoice_pdf"]
        });
        if (found) {
          order = await strapi.entityService.findOne("api::order.order", found.id, {
            populate: ["invoice_pdf"]
          });
        }
      }

      if (!order) {
        return ctx.notFound("Orden no encontrada.");
      }

      const targetEmail = (email || order.customer_email || "").trim();
      if (!targetEmail) {
        return ctx.badRequest("Por favor ingresa un correo electrónico de destino válido.");
      }

      // Si se proporcionó un email nuevo y la orden no tenía o era diferente, actualizarlo en Strapi
      if (email && email.trim() !== order.customer_email) {
        await strapi.documents("api::order.order").update({
          documentId: order.documentId,
          data: { customer_email: email.trim() }
        });
        await strapi.documents("api::order.order").publish({
          documentId: order.documentId
        });
        order.customer_email = email.trim();
      }

      // Enviar email usando el servicio de Resend
      const result = await strapi.service("api::order.order").sendInvoiceEmail(order, order.invoice_pdf?.url || null, {
        recipientEmail: targetEmail
      });

      return ctx.send({
        success: true,
        message: `Factura enviada exitosamente a ${targetEmail}`,
        emailId: result.emailId,
        recipient: targetEmail
      });
    } catch (err) {
      strapi.log.error(`[sendInvoiceEmailManually] Error: ${err.message}`);
      return ctx.internalServerError(err.message);
    }
  },
}));
