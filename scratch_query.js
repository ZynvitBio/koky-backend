const strapi = require('@strapi/strapi');

async function main() {
  const app = await strapi().load();
  const orders = await app.documents('api::order.order').findMany({
    limit: 5
  });
  console.log(JSON.stringify(orders, null, 2));
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
