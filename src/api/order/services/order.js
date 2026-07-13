'use strict';

const { createCoreService } = require('@strapi/strapi').factories;
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

module.exports = createCoreService('api::order.order', ({ strapi }) => ({
  async generateInvoicePDF(order) {
    // 1. Crear directorio temporal si no existe
    const tempDir = path.join(process.cwd(), 'public', 'temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    const tempFilePath = path.join(tempDir, `Factura_Koky_${order.id}_${Date.now()}.pdf`);

    await new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const writeStream = fs.createWriteStream(tempFilePath);
      doc.pipe(writeStream);

      // --- LOGOTIPO / ENCABEZADO ---
      try {
        const logoPath = path.join(process.cwd(), 'public', 'logo-icon.png');
        if (fs.existsSync(logoPath)) {
          doc.image(logoPath, 50, 45, { width: 40 });
        }
      } catch (imgErr) {
        strapi.log.error(`[Invoice PDF] Error al insertar imagen de logo: ${imgErr.message}`);
      }
      doc.font('Helvetica-Bold').fontSize(24).fillColor('#2e7d32').text('Koky Food', 100, 45);
      doc.font('Helvetica').fontSize(10).fillColor('#555555').text('Comida Saludable para Todos', 100, 72);

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
      doc.font('Helvetica').fillColor('#555555')
         .text(`Nombre: ${order.customer_name || 'Cliente Koky'}`, 50, 207)
         .text(`Teléfono (WhatsApp): ${order.whatsapp_id || 'N/A'}`, 50, 219)
         .text(`Dirección Entrega: ${order.shipping_address || 'N/A'}`, 50, 231);

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
      doc.text('COSTO ENVÍO (CABIFY):', 320, y, { width: 140, align: 'right' });
      doc.text(`$${deliveryCost.toLocaleString('es-CO')}`, 465, y, { width: 80, align: 'right' });

      y += 18;
      doc.moveTo(350, y).lineTo(545, y).strokeColor('#e0e0e0').stroke();
      y += 6;

      doc.font('Helvetica-Bold').fontSize(11).fillColor('#2e7d32');
      doc.text('VALOR TOTAL NETO:', 320, y, { width: 140, align: 'right' });
      doc.text(`$${totalAmount.toLocaleString('es-CO')}`, 465, y, { width: 80, align: 'right' });

      // --- PIE DE PÁGINA / NOTAS ---
      doc.moveTo(50, 720).lineTo(545, 720).strokeColor('#e0e0e0').lineWidth(0.5).stroke();
      doc.font('Helvetica').fontSize(8).fillColor('#888888')
         .text('Esta es una representación física de la transacción de compra digital realizada en Koky Food.', 50, 730, { align: 'center' })
         .font('Helvetica-Bold').text('¡GRACIAS POR TU COMPRA!', 50, 742, { align: 'center' });

      doc.end();

      writeStream.on('finish', () => resolve());
      writeStream.on('error', (err) => reject(err));
    });

    // 2. Subir a Strapi Media Library (Cloudinary)
    try {
      const stats = fs.statSync(tempFilePath);
      const fileData = {
        path: tempFilePath,
        name: `Factura_Koky_${order.id}.pdf`,
        type: 'application/pdf',
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
        // Enlazar el archivo a la orden en la base de datos
        await strapi.entityService.update('api::order.order', order.id, {
          data: {
            invoice_pdf: uploadedFiles[0].id
          }
        });
        return uploadedFiles[0];
      }
      throw new Error('No se pudo cargar el archivo PDF a la biblioteca de medios.');
    } catch (uploadErr) {
      // Intentar borrar el archivo temporal si existe
      try {
        if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
      } catch (e) {}
      throw uploadErr;
    }
  }
}));
