const { Rcon } = require('rcon-client');
const { getArkConfig } = require('./dataManager');

async function sendRconCommand(guildId, command) {
    const config = getArkConfig(guildId);
    if (!config) return { success: false, message: '❌ Servidor Ark no configurado. Usa `/setupark`.' };

    try {
        const rcon = new Rcon({
            host: config.ip,
            port: config.port,
            password: config.password,
            timeout: 5000 
        });

        await rcon.connect();
        const response = await rcon.send(command);
        await rcon.end();

        return { success: true, response: response };

    } catch (error) {
        console.error(`Error RCON en ${guildId}:`, error.message);
        return { success: false, message: `❌ Error de conexión RCON: ${error.message}` };
    }
}

module.exports = { sendRconCommand };
