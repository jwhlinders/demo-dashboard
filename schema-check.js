const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL || 'postgresql://postgres:Admin@localhost:5432/testdb' });

(async () => {
  const { rows: consultantCols } = await pool.query("SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'consultant' ORDER BY ordinal_position");
  const { rows: locatieCols } = await pool.query("SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'locaties' ORDER BY ordinal_position");
  console.log('CONSULTANT');
  console.log(JSON.stringify(consultantCols, null, 2));
  console.log('LOCATIES');
  console.log(JSON.stringify(locatieCols, null, 2));
  await pool.end();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
