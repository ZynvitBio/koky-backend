'use strict';

const { createCoreService } = require('@strapi/strapi').factories;
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { getDeliverySchedule } = require('../../../utils/delivery-helper');

module.exports = createCoreService('api::order.order', ({ strapi }) => ({
  async generateInvoicePDF(order, options = {}) {
    const { phone_number_id, whatsapp_token } = options;

    // 1. Crear directorio temporal si no existe
    const tempDir = path.join(process.cwd(), 'public', 'temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    const fileName = `Factura_Koky_${order.id}.pdf`;
    const tempFilePath = path.join(tempDir, `Factura_Koky_${order.id}_${Date.now()}.pdf`);

    await new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const writeStream = fs.createWriteStream(tempFilePath);
      doc.pipe(writeStream);

      // --- LOGOTIPO / ENCABEZADO ---
      try {
        const logoPath = path.join(process.cwd(), 'public', 'logoBlue20.png');
        if (fs.existsSync(logoPath)) {
          doc.image(logoPath, 50, 40, { width: 172 });
        }
      } catch (imgErr) {
        strapi.log.error(`[Invoice PDF] Error al insertar imagen de logo: ${imgErr.message}`);
      }
      doc.font('Helvetica').fontSize(10).fillColor('#555555').text('Comida Saludable para Todos', 50, 85);

      // --- DATOS DEL EMISOR ---
      doc.font('Helvetica-Bold').fontSize(10).fillColor('#333333').text('EMISOR:', 50, 110);
      doc.font('Helvetica').fillColor('#555555')
         .text('JONATHAN BARRIOS BRITO', 50, 122)
         .text('NIT: 101851851', 50, 134)
         .text('Dirección: Calle 119a 57-40', 50, 146)
         .text('Bogotá, Colombia', 50, 158);

      // --- INFO DE LA FACTURA ---
      doc.font('Helvetica-Bold').fontSize(14).fillColor('#2e7d32').text('FACTURA COMERCIAL', 350, 55, { align: 'right' });
      doc.font('Helvetica-Bold').fontSize(10).fillColor('#333333').text(`Factura N°: KOKY-${order.id}`, 350, 80, { align: 'right' });
      doc.font('Helvetica').fillColor('#555555')
         .text(`Fecha Emisión: ${new Date(order.createdAt).toLocaleDateString('es-CO')}`, 350, 95, { align: 'right' })
         .text(`Método Pago: ${order.payment_method === 'CASH' ? 'Efectivo' : 'Tarjeta / Digital'}`, 350, 110, { align: 'right' })
         .text(`Estado Pago: ${order.payment_status || 'PENDIENTE'}`, 350, 125, { align: 'right' });

      // --- CLIENTE ---
      doc.moveTo(50, 180).lineTo(545, 180).strokeColor('#e0e0e0').stroke();
      doc.font('Helvetica-Bold').fontSize(10).fillColor('#333333').text('FACTURADO A:', 50, 195);
      let fullDeliveryAddress = order.shipping_address || 'N/A';
      if (order.shipping_notes && !fullDeliveryAddress.toLowerCase().includes(order.shipping_notes.toLowerCase())) {
        fullDeliveryAddress += ` (${order.shipping_notes})`;
      }
      doc.font('Helvetica').fillColor('#555555')
         .text(`Nombre: ${order.customer_name || 'Cliente Koky'}`, 50, 207)
         .text(`Teléfono (WhatsApp): ${order.whatsapp_id || 'N/A'}`, 50, 219)
         .text(`Dirección Entrega: ${fullDeliveryAddress}`, 50, 231, { width: 480 });

      // --- TABLA DE DETALLES ---
      doc.moveTo(50, 255).lineTo(545, 255).strokeColor('#2e7d32').lineWidth(1.5).stroke();

      let y = 265;
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#333333');
      doc.text('DESCRIPCIÓN DEL PRODUCTO', 50, y);
      doc.text('CANT', 350, y, { width: 40, align: 'center' });
      doc.text('V. UNITARIO', 400, y, { width: 70, align: 'right' });
      doc.text('V. TOTAL', 475, y, { width: 70, align: 'right' });

      doc.moveTo(50, y + 12).lineTo(545, y + 12).strokeColor('#e0e0e0').lineWidth(0.5).stroke();
      y += 22;

      doc.font('Helvetica').fontSize(9).fillColor('#555555');
      const items = order.items || [];
      let subtotal = 0;

      for (const item of items) {
        const itemTotal = Number(item.price) * item.quantity;
        subtotal += itemTotal;

        doc.text(item.name, 50, y);
        doc.text(item.quantity.toString(), 350, y, { width: 40, align: 'center' });
        doc.text(`$${Number(item.price).toLocaleString('es-CO')}`, 400, y, { width: 70, align: 'right' });
        doc.text(`$${itemTotal.toLocaleString('es-CO')}`, 475, y, { width: 70, align: 'right' });

        y += 18;
        if (y > 700) {
          doc.addPage();
          y = 50;
        }
      }

      doc.moveTo(50, y).lineTo(545, y).strokeColor('#e0e0e0').stroke();
      y += 10;

      // --- TOTALES ---
      const totalAmount = Number(order.total_amount);
      const deliveryCost = totalAmount - subtotal;

      doc.font('Helvetica').fontSize(9).fillColor('#777777');
      doc.text('SUBTOTAL PRODUCTOS:', 320, y, { width: 140, align: 'right' });
      doc.text(`$${subtotal.toLocaleString('es-CO')}`, 465, y, { width: 80, align: 'right' });

      y += 15;
      doc.text('COSTO ENVÍO:', 320, y, { width: 140, align: 'right' });
      doc.text(`$${deliveryCost.toLocaleString('es-CO')}`, 465, y, { width: 80, align: 'right' });

      y += 18;
      doc.moveTo(350, y).lineTo(545, y).strokeColor('#e0e0e0').stroke();
      y += 6;

      doc.font('Helvetica-Bold').fontSize(11).fillColor('#2e7d32');
      doc.text('VALOR TOTAL NETO:', 320, y, { width: 140, align: 'right' });
      doc.text(`$${totalAmount.toLocaleString('es-CO')}`, 465, y, { width: 80, align: 'right' });

      doc.moveTo(50, 720).lineTo(545, 720).strokeColor('#e0e0e0').lineWidth(0.5).stroke();
      doc.font('Helvetica-Bold').fontSize(10).fillColor('#333333').text('¡GRACIAS POR TU COMPRA!', 50, 730, { align: 'center' });
      doc.font('Helvetica').fontSize(8).fillColor('#888888')
         .text('www.koky.food', 50, 745, { align: 'center' })
         .text('somos@koky.food,  whatsapp: +573019447660', 50, 757, { align: 'center' });

      doc.end();

      writeStream.on('finish', () => resolve());
      writeStream.on('error', (err) => reject(err));
    });

    let mediaId = null;
    let pdfUrl = "";

    // 2. Opcional: Subir a Meta (WhatsApp Media) directamente si se proveen las credenciales
    if (phone_number_id && whatsapp_token) {
      try {
        strapi.log.info(`[Invoice Service] Subiendo PDF a los servidores de Meta...`);
        const fileBuffer = fs.readFileSync(tempFilePath);
        const blob = new Blob([fileBuffer], { type: 'application/pdf' });
        const formData = new FormData();
        formData.append('messaging_product', 'whatsapp');
        formData.append('file', blob, fileName);

        const metaResponse = await axios.post(
          `https://graph.facebook.com/v21.0/${phone_number_id}/media`,
          formData,
          {
            headers: {
              Authorization: `Bearer ${whatsapp_token}`
            }
          }
        );
        mediaId = metaResponse.data.id;
        strapi.log.info(`[Invoice Service] Subida a Meta exitosa. Media ID: ${mediaId}`);
      } catch (metaErr) {
        strapi.log.error(`[Invoice Service] Error al subir media a Meta: ${metaErr.response?.data ? JSON.stringify(metaErr.response.data) : metaErr.message}`);
      }
    }

    // 3. Subir a Strapi Media Library (Cloudinary)
    try {
      const stats = fs.statSync(tempFilePath);
      const fileData = {
        path: tempFilePath,
        filepath: tempFilePath,
        name: fileName,
        originalFilename: fileName,
        type: 'application/pdf',
        mimetype: 'application/pdf',
        size: stats.size,
      };

      const uploadService = strapi.plugin('upload').service('upload');
      const uploadedFiles = await uploadService.upload({
        data: {
          refId: order.id,
          ref: 'api::order.order',
          field: 'invoice_pdf',
        },
        files: fileData,
      });

      // Borrar archivo temporal local
      try {
        fs.unlinkSync(tempFilePath);
      } catch (unlinkErr) {
        strapi.log.error(`[Invoice Service] Error al borrar archivo temporal: ${unlinkErr.message}`);
      }

      if (uploadedFiles && uploadedFiles.length > 0) {
        pdfUrl = uploadedFiles[0].url;
        await strapi.entityService.update('api::order.order', order.id, {
          data: {
            invoice_pdf: uploadedFiles[0].id
          }
        });
      }
    } catch (uploadErr) {
      strapi.log.error(`[Invoice Service] Error al cargar a Cloudinary: ${uploadErr.message}`);
      try {
        if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
      } catch (e) {}
    }

    return {
      url: pdfUrl,
      mediaId: mediaId
    };
  },

  async sendInvoiceEmail(order, pdfUrl = null, options = {}) {
    try {
      const recipientEmail = options.recipientEmail || order.customer_email;
      if (!recipientEmail) {
        throw new Error('No se encontró dirección de correo para enviar la factura.');
      }

      // Si no se proporcionó pdfUrl, verificar si la orden ya tiene factura o generarla
      let finalPdfUrl = pdfUrl;
      if (!finalPdfUrl) {
        if (order.invoice_pdf && order.invoice_pdf.url) {
          finalPdfUrl = order.invoice_pdf.url;
        } else {
          strapi.log.info(`[sendInvoiceEmail] La orden #${order.id} no tiene PDF generado. Generando ahora...`);
          const generated = await this.generateInvoicePDF(order);
          finalPdfUrl = generated.url;
        }
      }

      const customerName = order.customer_name || 'Cliente Koky';
      const items = order.items || [];
      let subtotal = 0;
      for (const item of items) {
        subtotal += (Number(item.price) || 0) * (Number(item.quantity) || 1);
      }
      const totalAmount = Number(order.total_amount) || subtotal;
      const shippingCost = Math.max(0, totalAmount - subtotal);

      // Horario y entrega conectados a festivos colombianos y Ley Emiliani
      const { productionNight, deliveryDay } = getDeliverySchedule(order.createdAt || new Date());

      let shippingAddress = order.shipping_address || 'Dirección acordada para entrega';
      if (order.shipping_notes && !shippingAddress.toLowerCase().includes(order.shipping_notes.toLowerCase())) {
        shippingAddress += ` (${order.shipping_notes})`;
      }

      const productsRowsHtml = items.map(item => {
        let imgUrl = item.image;
        if (imgUrl && !imgUrl.startsWith('http')) {
          imgUrl = `https://koky.food${imgUrl.startsWith('/') ? '' : '/'}${imgUrl}`;
        }
        if (!imgUrl) {
          imgUrl = 'https://koky.food/assets/img/logoBlue20.png';
        }
        const itemTotal = (Number(item.price) || 0) * (Number(item.quantity) || 1);
        const presentation = item.contentPerUnit ? `Presentación: ${item.contentPerUnit}${item.unitAbbreviation || ''}` : '';

        return `
          <tr>
            <td style="padding: 12px 0; border-bottom: 1px solid #f1f5f9;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td width="55" valign="middle" style="padding-right: 14px;">
                    <img src="${imgUrl}" alt="${item.name}" width="52" height="52" style="display: block; border-radius: 8px; object-fit: cover; border: 1px solid #e2e8f0; background: #fafafa;">
                  </td>
                  <td valign="middle">
                    <div style="font-size: 14px; font-weight: 700; color: #1e293b;">${item.name}</div>
                    ${presentation ? `<div style="font-size: 12px; color: #64748b;">${presentation}</div>` : ''}
                    <div style="font-size: 12px; color: #2e7d32; font-weight: 600;">Cantidad: ${item.quantity} x $${Number(item.price).toLocaleString('es-CO')}</div>
                  </td>
                  <td align="right" valign="middle" style="font-size: 14px; font-weight: 700; color: #1e293b; white-space: nowrap;">
                    $${itemTotal.toLocaleString('es-CO')}
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        `;
      }).join('');

      const emailHtml = `
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Factura y Confirmación de Pedido - Koky Food</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f4f6f8; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #2d3748; line-height: 1.6;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #f4f6f8; padding: 30px 10px;">
  <tr>
    <td align="center">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width: 620px; background-color: #ffffff; border-radius: 14px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.06); border: 1px solid #e2e8f0;">
        
        <!-- Header Koky con logoBlue20 -->
        <tr>
          <td style="background-color: #ffffff; padding: 26px 24px 18px 24px; text-align: center; border-bottom: 1px solid #f0fdf4;">
            <a href="https://koky.food" target="_blank" style="text-decoration: none; display: inline-block;">
              <img src="https://koky.food/assets/img/logoBlue20.png" alt="Koky Food" width="185" style="display: block; margin: 0 auto; max-width: 100%; height: auto; border: 0;" />
            </a>
            <div style="color: #2e7d32; font-size: 12px; letter-spacing: 1.5px; text-transform: uppercase; font-weight: 700; margin-top: 8px;">Comida Saludable para Todos</div>
          </td>
        </tr>

        <!-- Banner Confirmación Aprobada -->
        <tr>
          <td style="background: linear-gradient(135deg, #2e7d32 0%, #1b5e20 100%); padding: 14px 24px; text-align: center;">
            <span style="display: inline-block; background-color: #ffffff; color: #1b5e20; font-size: 11px; font-weight: 800; padding: 4px 12px; border-radius: 20px; text-transform: uppercase; letter-spacing: 0.5px; margin-right: 10px;">✓ Pago Aprobado</span>
            <span style="color: #ffffff; font-weight: 700; font-size: 14px; letter-spacing: 0.3px;">Factura N° KOKY-${order.id}</span>
          </td>
        </tr>

        <!-- Greeting Body -->
        <tr>
          <td style="padding: 32px 30px 20px 30px;">
            <h2 style="margin: 0 0 12px 0; color: #1a202c; font-size: 20px; font-weight: 700;">¡Hola, ${customerName}! 🥗</h2>
            <p style="margin: 0 0 18px 0; font-size: 15px; color: #4a5568; line-height: 1.6;">
              Nos alegra mucho saludarte. Tu pago ha sido aprobado con éxito y tu pedido ya tiene un lugar reservado en nuestra cocina.
            </p>

            <!-- Delivery Schedule Card -->
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; margin-bottom: 26px;">
              <tr>
                <td style="padding: 16px 20px;">
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                    <tr>
                      <td width="28" valign="top" style="font-size: 18px; line-height: 22px;">👩‍🍳</td>
                      <td style="padding-left: 10px; font-size: 14px; color: #334155; padding-bottom: 8px;">
                        <strong>Preparación artesanal:</strong> Entra a cocina ${productionNight} con ingredientes frescos.
                      </td>
                    </tr>
                    <tr>
                      <td width="28" valign="top" style="font-size: 18px; line-height: 22px;">🛵</td>
                      <td style="padding-left: 10px; font-size: 14px; color: #334155; padding-bottom: 8px;">
                        <strong>Entrega estimada:</strong> ${deliveryDay}.
                      </td>
                    </tr>
                    <tr>
                      <td width="28" valign="top" style="font-size: 18px; line-height: 22px;">📍</td>
                      <td style="padding-left: 10px; font-size: 14px; color: #334155;">
                        <strong>Dirección de entrega:</strong> ${shippingAddress}
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>

            <!-- Section Title -->
            <h3 style="margin: 0 0 14px 0; font-size: 15px; font-weight: 700; color: #1e293b; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 2px solid #2e7d32; padding-bottom: 6px; display: inline-block;">
              Resumen de tu Pedido
            </h3>

            <!-- Products Table -->
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-bottom: 24px;">
              ${productsRowsHtml}
            </table>

            <!-- Totals Breakdown -->
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #f8fafc; border-radius: 8px; border: 1px solid #e2e8f0; margin-bottom: 26px;">
              <tr>
                <td style="padding: 16px 20px;">
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                    <tr>
                      <td style="font-size: 14px; color: #64748b; padding-bottom: 6px;">Subtotal productos:</td>
                      <td align="right" style="font-size: 14px; color: #1e293b; font-weight: 600; padding-bottom: 6px;">$${subtotal.toLocaleString('es-CO')} COP</td>
                    </tr>
                    <tr>
                      <td style="font-size: 14px; color: #64748b; padding-bottom: 8px;">Costo de envío (Domicilio):</td>
                      <td align="right" style="font-size: 14px; color: #1e293b; font-weight: 600; padding-bottom: 8px;">${shippingCost > 0 ? `$${shippingCost.toLocaleString('es-CO')} COP` : '<span style="color:#2e7d32;">Gratis</span>'}</td>
                    </tr>
                    <tr>
                      <td colspan="2" style="border-top: 1px solid #e2e8f0; padding-top: 10px;"></td>
                    </tr>
                    <tr>
                      <td style="font-size: 16px; color: #1e293b; font-weight: 700;">Total Pagado:</td>
                      <td align="right" style="font-size: 18px; color: #2e7d32; font-weight: 800;">$${totalAmount.toLocaleString('es-CO')} COP</td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>

            ${finalPdfUrl ? `
            <!-- Call to Action Button -->
            <div style="text-align: center; margin: 30px 0 24px 0;">
              <a href="${finalPdfUrl}" target="_blank" style="display: inline-block; background-color: #2e7d32; color: #ffffff; text-decoration: none; font-weight: 700; font-size: 15px; padding: 14px 28px; border-radius: 8px; box-shadow: 0 4px 12px rgba(46, 125, 50, 0.25);">
                🖨️ Descargar Factura en PDF para Imprimir
              </a>
            </div>
            ` : ''}

            <!-- Note about Ink-saving white paper PDF -->
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #fffbeb; border: 1px solid #fef3c7; border-radius: 8px; margin-bottom: 26px;">
              <tr>
                <td style="padding: 12px 16px; font-size: 13px; color: #92400e; line-height: 1.5;">
                  📄 <strong>Tu factura adjunta:</strong> En este correo encontrarás adjunto el documento comercial en PDF (formato hoja blanca limpia, sin fondos oscuros para cuidar tu tinta si deseas imprimirlo).
                </td>
              </tr>
            </table>

            <!-- Dale Carnegie closing message -->
            <p style="margin: 0 0 8px 0; font-size: 14px; color: #475569; line-height: 1.6;">
              Para nosotros es un honor y una alegría servirte. Si tienes alguna indicación adicional sobre tu entrega o tus productos, responderemos con el mayor gusto.
            </p>
            <p style="margin: 0; font-size: 14px; color: #1e293b; font-weight: 600;">
              Con aprecio,<br>
              <span style="color: #2e7d32;">El equipo de Koky Food 🌱</span>
            </p>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background-color: #f1f5f9; padding: 22px 30px; text-align: center; border-top: 1px solid #e2e8f0; font-size: 12px; color: #64748b; line-height: 1.6;">
            <div><strong>Koky Food</strong> — Comida Saludable para Todos</div>
            <div>Bogotá, Colombia • WhatsApp: <a href="https://wa.me/573019447660" style="color: #2e7d32; text-decoration: none;">+57 301 944 7660</a> • <a href="mailto:somos@koky.food" style="color: #2e7d32; text-decoration: none;">somos@koky.food</a></div>
            <div style="margin-top: 8px; color: #94a3b8; font-size: 11px;">Este correo confirma tu transacción y fue generado automáticamente tras la aprobación de tu pago.</div>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>
</body>
</html>
      `;

      const resendApiKey = process.env.RESEND_API_KEY;
      if (!resendApiKey) {
        throw new Error('RESEND_API_KEY no está configurada en las variables de entorno del servidor.');
      }
      const emailPayload = {
        from: 'Koky Food <somos@koky.food>',
        to: [recipientEmail],
        subject: options.subject || `🧾 Tu Factura y Confirmación de Pedido #KOKY-${order.id} - Koky Food`,
        html: emailHtml,
      };

      if (finalPdfUrl) {
        emailPayload.attachments = [
          {
            filename: `Factura_Koky_${order.id}.pdf`,
            path: finalPdfUrl,
          },
        ];
      }

      const axiosInstance = axios.default || axios;
      const resendResponse = await axiosInstance.post('https://api.resend.com/emails', emailPayload, {
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          'Content-Type': 'application/json',
        },
      });

      strapi.log.info(`[sendInvoiceEmail] Correo enviado exitosamente a ${recipientEmail}. Resend ID: ${resendResponse.data?.id}`);
      return {
        success: true,
        emailId: resendResponse.data?.id,
        recipient: recipientEmail,
      };
    } catch (err) {
      strapi.log.error(`[sendInvoiceEmail] Error enviando email: ${err.response ? JSON.stringify(err.response.data) : err.message}`);
      throw err;
    }
  }
}));
