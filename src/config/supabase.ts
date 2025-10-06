/**
 * Configuração do Supabase - Advogado\Web
 */
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://uajwkqipbyxzvwjpitxl.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVhandrcWlwYnl4enZ3anBpdHhsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg1ODkwNjEsImV4cCI6MjA3NDE2NTA2MX0.8dG1Gylum9_SyhzzQuddMKxHoQXwXcAFnw_wTSgmjL8';

export const supabase = createClient(supabaseUrl, supabaseKey);
