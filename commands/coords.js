const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { loadTribes, saveTribes } = require('../utils/dataManager');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('coords')
        .setDescription('📍 Gestión de coordenadas de la tribu.')
        .addSubcommand(s => s.setName('add').setDescription('Añadir coordenada')
            .addStringOption(o => o.setName('nombre').setDescription('Nombre del punto (Ej: Base Metal)').setRequired(true)) // <-- Faltaba descripción
            .addStringOption(o => o.setName('lat').setDescription('Latitud').setRequired(true)) // <-- Faltaba descripción
            .addStringOption(o => o.setName('lon').setDescription('Longitud').setRequired(true))) // <-- Faltaba descripción
        .addSubcommand(s => s.setName('list').setDescription('Ver lista de coordenadas'))
        .addSubcommand(s => s.setName('remove').setDescription('Borrar coordenada')
            .addStringOption(o => o.setName('nombre').setDescription('Nombre exacto de la coordenada').setRequired(true))), // <-- Faltaba descripción

    async execute(interaction) {
        const tribes = loadTribes(interaction.guild.id);
        let myTribeName = null, myTribeData = null;
        
        // Buscar tribu
        for (const [name, data] of Object.entries(tribes)) {
            if (data.members.some(m => m.discordId === interaction.user.id)) {
                myTribeName = name; myTribeData = data; break;
            }
        }
        if (!myTribeData) return interaction.reply({ content: '❌ No tienes tribu.', ephemeral: true });

        // Inicializar array
        if (!myTribeData.coords) myTribeData.coords = [];

        const sub = interaction.options.getSubcommand();

        if (sub === 'add') {
            const name = interaction.options.getString('nombre');
            const lat = interaction.options.getString('lat');
            const lon = interaction.options.getString('lon');
            
            myTribeData.coords.push({ name, lat, lon, addedBy: interaction.user.tag });
            saveTribes(interaction.guild.id, tribes);
            return interaction.reply(`📍 Coordenada **${name}** (${lat}, ${lon}) guardada.`);
        }

        if (sub === 'list') {
            if (myTribeData.coords.length === 0) return interaction.reply('📭 No hay coordenadas guardadas.');
            
            const embed = new EmbedBuilder().setTitle(`📍 Coordenadas: ${myTribeName}`).setColor('Blue');
            let desc = '';
            myTribeData.coords.forEach(c => desc += `**${c.name}**: ${c.lat} / ${c.lon} (por ${c.addedBy})\n`);
            embed.setDescription(desc);
            return interaction.reply({ embeds: [embed], ephemeral: true }); // Solo visible para el usuario (seguridad)
        }

        if (sub === 'remove') {
            const name = interaction.options.getString('nombre');
            const initLen = myTribeData.coords.length;
            myTribeData.coords = myTribeData.coords.filter(c => c.name !== name);
            
            if (myTribeData.coords.length === initLen) return interaction.reply('❌ No encontré esa coordenada.');
            
            saveTribes(interaction.guild.id, tribes);
            return interaction.reply(`🗑️ Coordenada **${name}** eliminada.`);
        }
    },
};
