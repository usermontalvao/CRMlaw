import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '..', '.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing env vars: VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const bucket = 'assinados';
const args = new Set(process.argv.slice(2));
const shouldDelete = args.has('--confirm');
const verbose = args.has('--verbose');

const requestIds = [
  '52a34c66-031c-4bda-8831-e5530eaa177f',
  'b624f111-1d6a-46c0-b6bd-ccf839c75195',
  '4ac4c9bf-5022-4962-a6ef-712b0e1e5cc8',
  '84a8c415-3af0-49f6-aed2-e4d4b2e19395',
  'de529635-54e6-4dc2-9b43-cf9a579a37b7',
  '4ddb922b-5a8e-4099-9069-c5a1ff43421a',
  '62819234-7a9e-4c9d-8506-82091f63c9d1',
  'aca8bdea-2b7d-4644-8b03-7caa666ab7f4',
  '0f3f88d0-ff27-4630-aaac-a53f0ad2c840',
  'df4c7d58-ef7f-448b-ab30-34cca5328469',
  '092f4a5c-7ce7-4ef5-9b99-dbf420338bd7',
  'be4c3b7e-8fbd-484f-a431-7468be897648',
  '3ed98ae3-067c-4d71-80e6-7af7558c5080',
  'd0c59be4-4ad1-4c01-9e98-e9cf91b7ff4a',
  '4ae9b53f-d366-483a-a6c7-a6992f2353ab',
  '9c203b80-0b1a-4f61-bc7c-485219f00cac',
  'f92ed3ec-cbee-4a71-a44c-61af2a7b992c',
  'd31ba472-c38b-4e7a-9662-96cbabb20c6b',
  'c26dbada-fae6-4eb9-8a08-bcda03fe4862',
  '2f3836da-fbd1-40d5-86d9-459491f308f4',
  '0f63f242-aed2-4c1d-9e05-74e2e7fccc48',
  'ae50ba2a-d5d9-4def-905b-7faffd35aa39',
  '677c6b84-2dd1-4ad0-b3e3-2b80da28e941',
  'dda8b1af-94ba-4fe5-b52b-63928271eec1',
  'b7aac25f-0cb8-4d51-8e55-444e33509f00',
  '2600f85e-7b50-49e2-8636-799cc300b267',
  '082971aa-0c9c-4aa2-850f-a13aac190d6f',
  '9779574a-736c-4772-bed9-0681cc87fa5c',
  'acc63706-490c-46b7-9ecb-d5adc83b623c',
  '09125038-27c8-431c-a4ef-d87fd5a03516',
  'c55b5623-d832-4623-a734-b8cffd55c354',
  '45ff862b-22e6-41d8-a96d-0a82c206aeb5',
  'dbc0978a-f72b-4e42-8e9e-84cd545efe7f',
  '660f8f1e-c0b2-4e81-b14b-7ff43abce465',
  'd9d692e6-402a-4715-bfb2-d0acbe0d8006',
  '2406773b-a48b-49a8-b112-e27fb2c99777',
  'a08c71a0-1302-45eb-b2f5-4d9144ec9197',
  '226bf46e-2612-4821-a606-49798b89b4a4',
  'f10b4066-3aee-4c2d-805c-ff1612d5700e',
  '083fe292-ed58-436a-b11e-4fdfc15639af',
  '70c532c9-0542-4c78-81d0-7be0dc7872a6',
  '0ca3f88d-629f-4976-87a3-dc17e947a2e0',
  '073db223-9e70-45af-9147-c0219cefa05e',
  'abe57148-e92c-4e05-96b7-dfb0bfae8d35',
  '63373f71-f484-459b-90ee-d90ca9587035',
  '081f1f45-8244-450c-92a0-32371dbb0e9d',
  'a60f0484-2dad-4655-8a19-4cbba8b79ee7',
  '5aafa2b3-9d4d-4ab1-8316-5956179e3427',
  '83b5ac96-985c-4172-a931-b850a867aa9e',
  '193b51d5-fa33-41e1-b1dd-dfe393bc55cc',
  '04f78392-01ed-4c6d-aca7-4b0dbe2a7896',
  '784a76e4-9c89-48d1-810b-b18fe3c47752',
  '075e3630-0fcb-45ee-9692-4936d098fd4f',
  'e11f8d06-4220-42f0-92ea-1ce4f5d671b5',
  'b2a8ffda-ffdb-4504-9b6a-d2b8c289c76b',
  '28c5f912-fe81-42c0-93ce-b446868d585a',
  '54561ce1-813d-4f42-bc45-5ee32b5ec50e',
  '29bbc046-eeaa-48f8-8eb3-b5f53c422063',
  'b087bcf7-ffa7-473f-ab8b-25f8af951c6e',
  'eadba75f-2363-444c-a75e-889ce7e019c7',
  '7e81ea78-39e6-4032-b407-2817fbc73821',
  '3aef8d59-d309-4319-a8d7-b56620314941',
  '27fec7f0-3bdc-4227-bfb6-c38796444ece',
  '2abf0b47-52da-4b5f-96fd-93814ef62936',
  '8e98167d-371d-4122-943e-8e93ff062f91',
  'cf856294-4230-486e-9d23-b1d51c9a428c',
  'a013bbed-77f5-423d-a376-383056789a3c',
  '1bb20585-b602-4afe-8b4a-b57604811936',
  'd6124245-c07b-4b94-ab1b-cb7a1f824e68',
  '583f1a21-9247-4927-8767-163431293bb7',
  '4ae14098-f694-49d0-ae0a-1aeb281ca713',
  '18e01358-9ccf-439d-8ccf-285ad1958ff7',
  '44238abb-f73a-4a1d-aa61-840e9136229a',
  '5f5343d3-a9af-43c5-97ba-b1ae857f0b6d',
  'fcfd6ac6-b459-48f8-b02b-df44d215f343',
  'd2e532a5-4b12-40a2-8545-06b91a961f70',
  '79c897d1-1e60-43d2-a03f-59ff2e296a3f',
  '0f99377c-4dc7-4d78-bd20-86c1af0a0914',
  '1d69e19a-57c8-42e6-8dbb-b74c1ecdc590',
];

async function listFiles(prefix) {
  const { data, error } = await supabase.storage.from(bucket).list(prefix, {
    limit: 100,
    offset: 0,
    sortBy: { column: 'name', order: 'asc' },
  });

  if (error) throw error;
  return data ?? [];
}

async function main() {
  const targets = [];

  for (const requestId of requestIds) {
    const files = await listFiles(requestId);
    for (const file of files) {
      if (!file?.name) continue;
      targets.push({
        requestId,
        path: `${requestId}/${file.name}`,
        size: Number(file.metadata?.size || 0),
      });
    }
  }

  const uniqueTargets = Array.from(new Map(targets.map((item) => [item.path, item])).values());
  const totalBytes = uniqueTargets.reduce((sum, item) => sum + item.size, 0);

  console.log(`Bucket: ${bucket}`);
  console.log(`Request IDs analisados: ${requestIds.length}`);
  console.log(`Arquivos encontrados: ${uniqueTargets.length}`);
  console.log(`Espaco aproximado: ${(totalBytes / 1024 / 1024).toFixed(2)} MB`);

  if (verbose) {
    for (const target of uniqueTargets) {
      console.log(`- ${target.path} (${target.size} bytes)`);
    }
  }

  if (!shouldDelete) {
    console.log('\nDry-run finalizado. Rode com --confirm para apagar de verdade.');
    return;
  }

  if (!uniqueTargets.length) {
    console.log('\nNenhum arquivo para apagar.');
    return;
  }

  const { data, error } = await supabase.storage
    .from(bucket)
    .remove(uniqueTargets.map((item) => item.path));

  if (error) {
    console.error('\nErro ao apagar arquivos:', error.message);
    process.exit(1);
  }

  console.log('\nArquivos removidos com sucesso.');
  if (verbose) {
    console.log(JSON.stringify(data, null, 2));
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
