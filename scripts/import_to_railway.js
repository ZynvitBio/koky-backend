const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

async function importToRailway() {
  const connectionString = process.env.RAILWAY_DATABASE_URL || process.argv[2];

  if (!connectionString) {
    console.error('Error: Debes proporcionar la URL de conexion de Railway.');
    console.error('Uso: node scripts/import_to_railway.js "<MYSQL_URL_DE_RAILWAY>"');
    process.exit(1);
  }

  const backupFile = path.join(__dirname, '..', 'koky_database_backup.sql');
  if (!fs.existsSync(backupFile)) {
    console.error(`Error: No se encontro el archivo de backup en ${backupFile}`);
    process.exit(1);
  }

  console.log('Leyendo archivo de respaldo local...');
  const sql = fs.readFileSync(backupFile, 'utf8');

  console.log('Conectando a la base de datos de Railway...');
  const conn = await mysql.createConnection(connectionString + '?multipleStatements=true');

  console.log('Ejecutando importacion en Railway...');
  await conn.query(sql);

  console.log('Importacion completada con exito en Railway!');
  await conn.end();
}

importToRailway().catch(err => {
  console.error('Error durante la importacion a Railway:', err.message);
  process.exit(1);
});
