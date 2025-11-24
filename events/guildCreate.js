const { Events, EmbedBuilder, ChannelType, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

// 👇 CAMBIA ESTO POR TU ENLACE REAL
const SUPPORT_INVITE_LINK = 'https://discord.gg/pBPRS64GKq';

module.exports = {
    name: Events.GuildCreate,
    async execute(guild) {
        // 1. Buscar un canal donde enviar el mensaje (SystemChannel o el primero de texto)
        let channel = guild.systemChannel;
        
        if (!channel) {
            channel = guild.channels.cache.find(c => 
                c.type === ChannelType.GuildText && 
                c.permissionsFor(guild.members.me).has(PermissionFlagsBits.SendMessages)
            );
        }

        // 2. Botón de Soporte
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setLabel('📞 Servidor de Soporte')
                .setStyle(ButtonStyle.Link)
                .setURL(SUPPORT_INVITE_LINK)
        );

        // 3. Embed de Presentación "Todo en Uno"
        const welcomeEmbed = new EmbedBuilder()
            .setColor('#00BFFF') // Azul profesional
            .setTitle(`🦖 ¡Gracias por invitar a ${guild.client.user.username}!`)
            .setDescription(`Soy el sistema definitivo para la gestión de servidores de **Ark: Survival Evolved/Ascended**. Automatizo roles, tribus, economía y seguridad.`)
            .setThumbnail(guild.client.user.displayAvatarURL())
            .addFields(
                // --- SECCIÓN CRÍTICA: SETUP ---
                { 
                    name: '🚀 PASO 1: INICIALIZACIÓN (OBLIGATORIO)', 
                    value: '> **Ejecuta el comando:** `/setup`\nEsto creará las categorías, canales y roles necesarios para que yo funcione.\n\n💡 **Nota Importante:** Una vez creado todo, **puedes cambiar el nombre** de cualquier canal o categoría manualmente a tu gusto. Yo los reconozco por su ID interna, así que personalízalos sin miedo.' 
                },
                
                // --- SECCIÓN RESUMEN DE FUNCIONES ---
                { 
                    name: '🛠️ Funcionalidades y Comandos', 
                    value: 'Una vez configurado, tendrás acceso a todo esto:' 
                },
                {
                    name: '🦕 Gestión de Tribus',
                    value: '`/tribu` - Panel interactivo (Reclutar, Kick, Ascender, Logs).\n`/tribu checkin` - Sistema anti-inactividad para bases.\n`/infoplayer` - Fichas de jugadores.'
                },
                {
                    name: '⚔️ Diplomacia & Guerra',
                    value: '`/diplomacia alianza` - Formalizar alianzas con canal compartido.\n`/diplomacia guerra` - Declarar guerras con canal de conflicto.\n`/diplomacia raideo` - **Alertas de Raid** en tiempo real.'
                },
                {
                    name: '💰 Economía',
                    value: '`/mercado` - Publica ofertas de compra/venta con sistema de tickets de negociación.\n`/kit` - Control de entrega de starter kits.'
                },
                {
                    name: '🛡️ Seguridad & Ark',
                    value: '`/setupark` - Vincula tu servidor de juego (RCON).\n`/arkban` - Banea en el juego y Discord simultáneamente.\n`/permaban` - Lista Negra persistente (Resiste Wipes).\n`/mute` - Aislamiento temporal.'
                },
                {
                    name: '♻️ Wipes y Temporadas',
                    value: '`/newseason` - Reinicio de temporada con Amnistía de Warns.\n`/fullwipe` - Borrado total (Season 0).'
                }
            )
            .setFooter({ text: 'Sistema FlowShadow • Multi-Server Edition' })
            .setTimestamp();

        // 4. Enviar el mensaje
        if (channel) {
            await channel.send({ embeds: [welcomeEmbed], components: [row] }).catch(console.error);
        } else {
            // Si no encuentra canal, intenta enviárselo al dueño por DM
            const owner = await guild.fetchOwner();
            await owner.send({ embeds: [welcomeEmbed], components: [row] }).catch(console.error);
        }
        
        console.log(`📥 Me he unido a un nuevo servidor: ${guild.name} (ID: ${guild.id})`);
    },
};
