const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { saveArkConfig } = require('../utils/dataManager');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('setupark')
        .setDescription('⚙️ Configura la conexión RCON con el servidor de Ark.')
        .addStringOption(o => o.setName('ip').setDescription('IP del servidor (Ej: 192.168.1.1)').setRequired(true))
        .addIntegerOption(o => o.setName('puerto').setDescription('Puerto RCON (No el del juego. Ej: 27020)').setRequired(true))
        .addStringOption(o => o.setName('password').setDescription('Contraseña de Admin').setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        const ip = interaction.options.getString('ip');
        const port = interaction.options.getInteger('puerto');
        const pass = interaction.options.getString('password');

        try {
            saveArkConfig(interaction.guild.id, ip, port, pass);
            await interaction.editReply(`✅ **Conexión Guardada.**\nServidor: \`${ip}:${port}\`\nContraseña: 🔒 (Encriptada en base de datos).`);
        } catch (e) {
            await interaction.editReply(`❌ Error al guardar: ${e.message}`);
        }
    },
};
