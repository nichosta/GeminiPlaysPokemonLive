class StreamOverlay {
    constructor() {
        this.ws = null;
        this.reconnectInterval = 5000;
        this.lastData = null;
        this.init();
    }

    init() {
        this.connectWebSocket();
        this.startPolling(); // Fallback to polling if WebSocket fails
    }

    connectWebSocket() {
        try {
            // Attempt WebSocket connection for real-time updates
            this.ws = new WebSocket('ws://localhost:8080'); // You'll need to add this to your agent
            
            this.ws.onopen = () => {
                console.log('WebSocket connected');
                this.setStatus('Connected', 'success');
            };

            this.ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    this.updateDisplay(data);
                } catch (error) {
                    console.error('Error parsing WebSocket data:', error);
                }
            };

            this.ws.onclose = () => {
                console.log('WebSocket disconnected, attempting to reconnect...');
                this.setStatus('Disconnected', 'error');
                setTimeout(() => this.connectWebSocket(), this.reconnectInterval);
            };

            this.ws.onerror = (error) => {
                console.error('WebSocket error:', error);
                this.setStatus('Error', 'error');
            };
        } catch (error) {
            console.error('Failed to create WebSocket:', error);
            this.setStatus('Connection Failed', 'error');
        }
    }

    // Fallback polling method
    async startPolling() {
        setInterval(async () => {
            if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
                try {
                    // Poll the agent for current state
                    // You'll need to add an HTTP endpoint to your agent
                    const response = await fetch('http://localhost:5000/agent/state');
                    if (response.ok) {
                        const data = await response.json();
                        this.updateDisplay(data);
                        this.setStatus('Polling', 'success');
                    }
                } catch (error) {
                    console.error('Polling failed:', error);
                    this.setStatus('Polling Failed', 'error');
                }
            }
        }, 2000); // Poll every 2 seconds
    }

    updateDisplay(data) {
        this.lastData = data;
        
        // Update location and minimap
        if (data.mapData && data.mapData.map_name) {
            document.getElementById('location-display').textContent = data.mapData.map_name;
            this.updateMinimap(data.mapData);
        }

        // Update commentary (truncate if too long)
        if (data.commentary) {
            let commentary = data.commentary;
            if (commentary.length > 300) {
                commentary = commentary.substring(0, 300) + '...';
            }
            document.getElementById('commentary-display').textContent = commentary;
        }

        // Update navigation (show as simple path)
        if (data.navigation && Array.isArray(data.navigation)) {
            const navText = data.navigation.length > 0 
                ? data.navigation.slice(0, 5).map(coord => `[${coord.x},${coord.y}]`).join(' → ')
                    + (data.navigation.length > 5 ? ' ...' : '')
                : 'No path planned';
            document.getElementById('navigation-display').textContent = navText;
        }

        // Update mistakes (truncate if too long)
        if (data.mistakes) {
            let mistakes = data.mistakes === 'N/A' ? 'N/A' : data.mistakes;
            if (mistakes.length > 150) {
                mistakes = mistakes.substring(0, 150) + '...';
            }
            document.getElementById('mistakes-display').textContent = mistakes;
        }

        // Update goals (truncate each)
        if (data.goalLongTerm) {
            let goal = data.goalLongTerm;
            if (goal.length > 80) goal = goal.substring(0, 80) + '...';
            document.getElementById('goal-long').textContent = goal;
        }
        if (data.goalMidTerm) {
            let goal = data.goalMidTerm;
            if (goal.length > 80) goal = goal.substring(0, 80) + '...';
            document.getElementById('goal-mid').textContent = goal;
        }
        if (data.goalShortTerm) {
            let goal = data.goalShortTerm;
            if (goal.length > 80) goal = goal.substring(0, 80) + '...';
            document.getElementById('goal-short').textContent = goal;
        }

        // Update party
        if (data.pokemon && Array.isArray(data.pokemon)) {
            this.updateParty(data.pokemon);
        }

        // Update inventory
        if (data.bag) {
            this.updateInventory(data.bag);
        }

        // Update badges
        if (data.badges && Array.isArray(data.badges)) {
            this.updateBadges(data.badges);
        }

        // Update money
        if (typeof data.money === 'number') {
            document.getElementById('money-display').textContent = `💰 $${data.money.toLocaleString()}`;
        }
    }

    updateMinimap(mapData) {
        const minimapDisplay = document.getElementById('minimap-display');
        if (mapData.map_data && Array.isArray(mapData.map_data)) {
            let mapText = '';
            mapData.map_data.forEach(row => {
                if (Array.isArray(row)) {
                    const rowText = row.map(cell => {
                        const tileType = cell.split(':')[1];
                        switch(tileType) {
                            case 'O': return '.';
                            case 'X': return '█';
                            case 'W': return '◊';
                            case '!': return '!';
                            case '~': return '~';
                            case '→': return '→';
                            case '←': return '←';
                            case '↑': return '↑';
                            case '↓': return '↓';
                            case 'C': return '+';
                            default: return '?';
                        }
                    }).join('');
                    mapText += rowText + '\n';
                }
            });
            minimapDisplay.textContent = mapText;
        } else {
            minimapDisplay.textContent = 'Map data unavailable';
        }
    }

    updateParty(pokemon) {
        const partyDisplay = document.getElementById('party-display');
        partyDisplay.innerHTML = '';
        
        pokemon.forEach(mon => {
            if (mon && mon.species) {
                const pokemonCard = document.createElement('div');
                pokemonCard.className = 'pokemon-card';
                
                // Truncate nickname if too long
                const displayName = (mon.nickname || mon.species);
                const shortName = displayName.length > 12 ? displayName.substring(0, 12) + '...' : displayName;
                
                pokemonCard.innerHTML = `
                    <div class="pokemon-name">${shortName}</div>
                    <div class="pokemon-stats">
                        <div>Lv.${mon.level || '?'}</div>
                        <div>${mon.species || 'Unknown'}</div>
                        <div>HP: ${mon.currentHP || '?'}/${mon.maxHP || '?'}</div>
                        <div>Moves: ${mon.moves ? mon.moves.filter(m => m.name).length : 0}</div>
                    </div>
                `;
                
                partyDisplay.appendChild(pokemonCard);
            }
        });
    }

    updateInventory(bag) {
        const inventoryDisplay = document.getElementById('inventory-display');
        let inventoryHTML = '';
        
        Object.entries(bag).forEach(([pocketName, items]) => {
            if (items && items.length > 0) {
                inventoryHTML += `<div class="inventory-category">${pocketName}:</div>`;
                items.slice(0, 8).forEach(item => { // Limit items per category
                    inventoryHTML += `
                        <div class="inventory-item">
                            <span>${item.name.length > 20 ? item.name.substring(0, 20) + '...' : item.name}</span>
                            <span>x${item.quantity}</span>
                        </div>
                    `;
                });
                if (items.length > 8) {
                    inventoryHTML += `<div class="inventory-item"><span>...and ${items.length - 8} more</span><span></span></div>`;
                }
            }
        });
        
        inventoryDisplay.innerHTML = inventoryHTML || 'No items';
    }

    updateBadges(badges) {
        const badgesDisplay = document.getElementById('badges-display');
        badgesDisplay.innerHTML = '';
        
        const allBadges = [
            'Stone', 'Knuckle', 'Dynamo', 'Heat',
            'Balance', 'Feather', 'Mind', 'Rain'
        ];
        
        allBadges.forEach((badgeName, index) => {
            const badge = document.createElement('div');
            badge.className = 'badge';
            badge.textContent = badgeName;
            
            const fullBadgeName = badgeName + ' Badge';
            if (!badges.includes(fullBadgeName)) {
                badge.style.opacity = '0.3';
                badge.style.background = 'linear-gradient(135deg, #666, #888)';
            }
            
            badgesDisplay.appendChild(badge);
        });
    }

    setStatus(status, type) {
        // You could add a status indicator here if needed
        console.log(`Status: ${status} (${type})`);
    }
}

// Initialize the overlay when the page loads
document.addEventListener('DOMContentLoaded', () => {
    new StreamOverlay();
});

// Mock data for testing (remove in production)
setTimeout(() => {
    const mockData = {
        mapData: {
            map_name: "ROUTE_101",
            map_data: [
                ["0,0:O", "1,0:O", "2,0:X", "3,0:O"],
                ["0,1:O", "1,1:W", "2,1:O", "3,1:!"],
                ["0,2:~", "1,2:~", "2,2:O", "3,2:O"]
            ]
        },
        commentary: "Analyzing route ahead. Warp nearby to investigate. Path seems clear but NPC blocks eastern route.",
        navigation: [{x: 5, y: 3}, {x: 6, y: 3}, {x: 7, y: 3}],
        mistakes: "Missed item ball to the north. Should backtrack if possible.",
        goalLongTerm: "Defeat Norman and obtain the Balance Badge",
        goalMidTerm: "Navigate through Petalburg Woods",
        goalShortTerm: "Move east to avoid blocked path",
        pokemon: [
            {
                nickname: "Treecko",
                species: "TREECKO",
                level: 12,
                currentHP: 35,
                maxHP: 40,
                moves: [{name: "TACKLE"}, {name: "LEER"}, {name: "ABSORB"}, {name: null}]
            },
            {
                nickname: "Poochyena",
                species: "POOCHYENA", 
                level: 8,
                currentHP: 28,
                maxHP: 28,
                moves: [{name: "TACKLE"}, {name: "HOWL"}, {name: null}, {name: null}]
            }
        ],
        bag: {
            "Items": [
                {name: "POTION", quantity: 3},
                {name: "ANTIDOTE", quantity: 1}
            ],
            "Pokeballs": [
                {name: "POKE_BALL", quantity: 5}
            ]
        },
        badges: ["Stone Badge"],
        money: 1250
    };
    
    // Simulate receiving data
    window.setTimeout(() => {
        const overlay = new StreamOverlay();
        overlay.updateDisplay(mockData);
    }, 100);
}, 2000);