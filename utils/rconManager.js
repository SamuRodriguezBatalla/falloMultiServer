const { Rcon } = require('rcon-client');
const { getArkServers } = require('./dataManager'); // <--- Cambio aquí

async function sendRconCommand(guildId, command, specificServerName = null) {
    const servers = getArkServers(guildId);
    
    if (!servers || servers.length === 0) {
        return { success: false, message: '❌ No hay servidores Ark configurados. Usa `/setupark`.' };
    }

    // Filtramos si se pidió uno específico
    const targets = specificServerName 
        ? servers.filter(s => s.name === specificServerName) 
        : servers;

    if (targets.length === 0) return { success: false, message: '❌ Servidor no encontrado.' };

    const results = [];

    // Ejecutar en paralelo
    await Promise.all(targets.map(async (server) => {
        try {
            const rcon = new Rcon({
                host: server.ip,
                port: server.port,
                password: server.password,
                timeout: 5000
            });

            await rcon.connect();
            const response = await rcon.send(command);
            await rcon.end();

            results.push({ server: server.name, success: true, response: response });
        } catch (error) {
            console.error(`Error RCON [${server.name}]:`, error.message);
            results.push({ server: server.name, success: false, message: error.message });
        }
    }));

    // Formatear respuesta global
    const successCount = results.filter(r => r.success).length;
    const totalResponse = results.map(r => `**${r.server}:** ${r.success ? (r.response || '✅') : `❌ (${r.message})`}`).join('\n');

    return { 
        success: successCount > 0, // Éxito si al menos uno funcionó
        message: totalResponse,
        rawResults: results // Para uso interno
    };
}

module.exports = { sendRconCommand };
