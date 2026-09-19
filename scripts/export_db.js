require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

async function exportDatabase() {
  const host = process.env.DATABASE_HOST || '127.0.0.1';
  const port = process.env.DATABASE_PORT || 3306;
  const user = process.env.DATABASE_USERNAME || 'root';
  const password = process.env.DATABASE_PASSWORD || '';
  const database = process.env.DATABASE_NAME || 'koky';

  console.log(`Conectando a MySQL (${user}@${host}:${port}/${database})...`);

  const conn = await mysql.createConnection({
    host,
    port,
    user,
    password,
    database
  });

  const [tables] = await conn.query('SHOW TABLES');
  const tableKey = Object.keys(tables[0])[0];
  const tableNames = tables.map(t => t[tableKey]);

  console.log(`Exportando ${tableNames.length} tablas...`);

  let dump = '-- KOKY FOOD DATABASE BACKUP\n';
  dump += `-- Generated at: ${new Date().toISOString()}\n`;
  dump += 'SET FOREIGN_KEY_CHECKS=0;\n';
  dump += 'SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";\n\n';

  for (const tableName of tableNames) {
    const [createTable] = await conn.query(`SHOW CREATE TABLE \`${tableName}\``);
    dump += `DROP TABLE IF EXISTS \`${tableName}\`;\n`;
    dump += createTable[0]['Create Table'] + ';\n\n';

    const [rows] = await conn.query(`SELECT * FROM \`${tableName}\``);
    if (rows.length > 0) {
      for (const row of rows) {
        const columns = Object.keys(row).map(c => `\`${c}\``).join(', ');
        const values = Object.values(row).map(v => conn.escape(v)).join(', ');
        dump += `INSERT INTO \`${tableName}\` (${columns}) VALUES (${values});\n`;
      }
      dump += '\n';
    }
  }

  dump += 'SET FOREIGN_KEY_CHECKS=1;\n';

  const outputPath = path.join(__dirname, '..', 'koky_database_backup.sql');
  fs.writeFileSync(outputPath, dump, 'utf8');

  const stats = fs.statSync(outputPath);
  console.log(`\nExportacion exitosa:`);
  console.log(`Archivo: ${outputPath}`);
  console.log(`Tamano: ${(stats.size / 1024).toFixed(1)} KB`);

  await conn.end();
}

exportDatabase().catch(err => {
  console.error('Error al exportar base de datos:', err);
  process.exit(1);
});
