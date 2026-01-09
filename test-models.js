import dotenv from 'dotenv';

dotenv.config();

async function listModels() {
  try {
    console.log('🔍 Listing available Gemini models for your API key...\n');

    const apiKey = process.env.GEMINI_API_KEY;
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;

    const response = await fetch(url);
    const data = await response.json();

    if (!response.ok) {
      console.error('❌ Error:', data);
      return;
    }

    console.log('✅ Available models:');
    console.log('='.repeat(50));

    if (data.models && data.models.length > 0) {
      for (const model of data.models) {
        console.log(`\nModel: ${model.name}`);
        console.log(`Display Name: ${model.displayName || 'N/A'}`);
        console.log(`Supported methods: ${model.supportedGenerationMethods?.join(', ') || 'N/A'}`);
      }
      console.log('\n' + '='.repeat(50));
      console.log(`\nTotal models available: ${data.models.length}`);
    } else {
      console.log('⚠️  No models found!');
    }

  } catch (error) {
    console.error('❌ Error listing models:', error.message);
    console.error('Full error:', error);
  }
}

listModels();
