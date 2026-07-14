'use strict';

/**
 * product controller
 */

const { createCoreController } = require('@strapi/strapi').factories;

function escapeXml(unsafe) {
  if (!unsafe) return "";
  return unsafe.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '\'': return '&apos;';
      case '"': return '&quot;';
      default: return c;
    }
  });
}

module.exports = createCoreController('api::product.product', ({ strapi }) => ({
  async facebookFeed(ctx) {
    try {
      const products = await strapi.entityService.findMany('api::product.product', {
        filters: { active: true },
        populate: { image: true },
      });

      let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">\n  <channel>\n    <title>Koky Food</title>\n    <link>https://www.koky.food</link>\n    <description>Menú y consumibles de Koky Food</description>\n`;

      for (const prod of products) {
        const id = prod.sku || prod.id;
        const title = escapeXml(prod.name);
        const description = escapeXml(prod.shortDescription || prod.longDescription || prod.name);
        const link = `https://www.koky.food/product/${prod.slug || prod.id}`;
        
        let imageLink = "";
        if (prod.image) {
          imageLink = prod.image.url.startsWith("http") ? prod.image.url : `https://www.koky.food${prod.image.url}`;
        }
        
        const availability = prod.stock > 0 ? "in stock" : "out of stock";
        const price = `${Number(prod.price).toFixed(2)} COP`;
        const brand = escapeXml(prod.brand || "Koky");

        xml += `    <item>
      <g:id>${id}</g:id>
      <g:title>${title}</g:title>
      <g:description>${description}</g:description>
      <g:link>${link}</g:link>
      <g:image_link>${imageLink}</g:image_link>
      <g:brand>${brand}</g:brand>
      <g:condition>new</g:condition>
      <g:availability>${availability}</g:availability>
      <g:price>${price}</g:price>
      <g:google_product_category>Food, Beverages &amp; Tobacco &gt; Food Items</g:google_product_category>
    </item>\n`;
      }

      xml += `  </channel>\n</rss>`;

      ctx.set('Content-Type', 'application/xml');
      ctx.body = xml;
    } catch (err) {
      strapi.log.error(`[Facebook Feed] Error: ${err.message}`);
      ctx.status = 500;
      ctx.body = { error: err.message };
    }
  }
}));
