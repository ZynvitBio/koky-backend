const mysql = require('mysql2');
require('dotenv').config();

const connection = mysql.createConnection({
  host: '127.0.0.1',
  port: 3306,
  user: 'root',
  password: '416262$jonathan',
  database: 'koky'
});

connection.connect((err) => {
  if (err) {
    console.error('Error connecting to MySQL:', err.message);
    process.exit(1);
  }

  connection.query("SELECT id, customer_name, delivery_date, published_at FROM orders ORDER BY id DESC LIMIT 5", (err, orders) => {
    if (err) {
      console.error('Error querying orders:', err.message);
    } else {
      console.log('\n--- LATEST ORDERS ---');
      console.log(orders);
    }
    connection.end();
  });
});
