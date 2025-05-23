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
                const isFainted = mon.currentHP === 0;
                pokemonCard.className = 'pokemon-card' + (isFainted ? ' fainted' : '');
                
                // Truncate nickname if too long
                const displayName = (mon.nickname || mon.species);
                const shortName = displayName.length > 12 ? displayName.substring(0, 12) + '...' : displayName;
                
                // Calculate HP percentage
                const hpPercent = mon.maxHP > 0 ? (mon.currentHP / mon.maxHP) * 100 : 0;
                let hpClass = '';
                if (hpPercent <= 25) hpClass = 'hp-red';
                else if (hpPercent <= 50) hpClass = 'hp-yellow';
                
                pokemonCard.innerHTML = `
                    <div class="pokemon-name">${shortName}</div>
                    <div class="pokemon-level">Lv.${mon.level || '?'} ${mon.species || 'Unknown'}</div>
                    <div class="pokemon-hp-container">
                        <div class="pokemon-hp-text">HP: ${mon.currentHP || 0}/${mon.maxHP || '?'}</div>
                        <div class="pokemon-hp-bar">
                            <div class="pokemon-hp-fill ${hpClass}" style="width: ${hpPercent}%"></div>
                        </div>
                    </div>
                    ${isFainted ? '<div class="fainted-indicator">Fainted</div>' : ''}
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
      map_name: "ROUTE110",
      width: 40,
      height: 100,
      tile_passability: {
        O: "walkable",
        X: "blocked",
        "~": "requires surf",
        "→": "ledge (only walkable in the indicated direction)",
        "←": "ledge (only walkable in the indicated direction)",
        "↑": "ledge (only walkable in the indicated direction)",
        "↓": "ledge (only walkable in the indicated direction)",
        ">": "walkable, higher elevation than player",
        "<": "walkable, lower elevation than player",
        "=": "walkable, transition elevation (any to any)",
        C: "connection to adjacent map area",
        W: "warp",
        "!": "npc",
      },
      map_data: [
        [
          "14,19:O",
          "15,19:X",
          "16,19:X",
          "17,19:X",
          "18,19:X",
          "19,19:X",
          "20,19:X",
          "21,19:X",
          "22,19:X",
          "23,19:X",
          "24,19:X",
          "25,19:X",
          "26,19:O",
          "27,19:O",
          "28,19:O",
        ],
        [
          "14,20:~",
          "15,20:~",
          "16,20:~",
          "17,20:~",
          "18,20:~",
          "19,20:~",
          "20,20:~",
          "21,20:~",
          "22,20:~",
          "23,20:~",
          "24,20:~",
          "25,20:X",
          "26,20:O",
          "27,20:O",
          "28,20:O",
        ],
        [
          "14,21:~",
          "15,21:~",
          "16,21:~",
          "17,21:~",
          "18,21:~",
          "19,21:~",
          "20,21:~",
          "21,21:~",
          "22,21:~",
          "23,21:~",
          "24,21:~",
          "25,21:X",
          "26,21:O",
          "27,21:O",
          "28,21:O",
        ],
        [
          "14,22:~",
          "15,22:~",
          "16,22:~",
          "17,22:~",
          "18,22:~",
          "19,22:~",
          "20,22:~",
          "21,22:~",
          "22,22:~",
          "23,22:~",
          "24,22:~",
          "25,22:~",
          "26,22:O",
          "27,22:O",
          "28,22:O",
        ],
        [
          "14,23:~",
          "15,23:~",
          "16,23:O",
          "17,23:O",
          "18,23:~",
          "19,23:~",
          "20,23:~",
          "21,23:~",
          "22,23:~",
          "23,23:~",
          "24,23:~",
          "25,23:~",
          "26,23:O",
          "27,23:O",
          "28,23:O",
        ],
        [
          "14,24:~",
          "15,24:O",
          "16,24:O",
          "17,24:O",
          "18,24:~",
          "19,24:~",
          "20,24:~",
          "21,24:~",
          "22,24:~",
          "23,24:~",
          "24,24:~",
          "25,24:~",
          "26,24:!",
          "27,24:O",
          "28,24:O",
        ],
        [
          "14,25:~",
          "15,25:X",
          "16,25:X",
          "17,25:X",
          "18,25:~",
          "19,25:~",
          "20,25:~",
          "21,25:~",
          "22,25:~",
          "23,25:~",
          "24,25:~",
          "25,25:~",
          "26,25:O",
          "27,25:O",
          "28,25:O",
        ],
        [
          "14,26:~",
          "15,26:O",
          "16,26:O",
          "17,26:O",
          "18,26:~",
          "19,26:~",
          "20,26:~",
          "21,26:~",
          "22,26:~",
          "23,26:~",
          "24,26:~",
          "25,26:~",
          "26,26:O",
          "27,26:O",
          "28,26:O",
        ],
        [
          "14,27:~",
          "15,27:~",
          "16,27:~",
          "17,27:~",
          "18,27:~",
          "19,27:~",
          "20,27:~",
          "21,27:~",
          "22,27:~",
          "23,27:~",
          "24,27:~",
          "25,27:~",
          "26,27:O",
          "27,27:O",
          "28,27:O",
        ],
        [
          "14,28:~",
          "15,28:~",
          "16,28:~",
          "17,28:~",
          "18,28:~",
          "19,28:~",
          "20,28:~",
          "21,28:~",
          "22,28:~",
          "23,28:~",
          "24,28:~",
          "25,28:~",
          "26,28:O",
          "27,28:O",
          "28,28:O",
        ],
      ],
      player_state: {
        position: [21, 24],
        facing: "right",
      },
      warps: [],
      npcs: [
        {
          id: 1,
          position: [26, 24],
          type: "CYCLING_TRIATHLETE_F",
          isOffScreen: 0,
          wandering: true,
        },
      ],
      connections: [],
    },
    inBattle: false,
    overworldControlsLocked: false,
    surfing: true,
    elevation: 1,
    partyCount: 6,
    pokemon: [
      {
        nickname: "TRAPINCH",
        species: "TRAPINCH",
        level: 23,
        currentHP: 0,
        maxHP: 60,
        moves: [
          {
            name: "BITE",
            pp: 24,
          },
          {
            name: "SAND_ATTACK",
            pp: 12,
          },
          {
            name: "FAINT_ATTACK",
            pp: 14,
          },
          {
            name: "NONE",
            pp: 0,
          },
        ],
      },
      {
        nickname: "NVCGR H",
        species: "BLAZIKEN",
        level: 38,
        currentHP: 104,
        maxHP: 116,
        moves: [
          {
            name: "STRENGTH",
            pp: 15,
          },
          {
            name: "CUT",
            pp: 30,
          },
          {
            name: "DOUBLE_KICK",
            pp: 26,
          },
          {
            name: "BLAZE_KICK",
            pp: 5,
          },
        ],
      },
      {
        nickname: "TTUUUWWWWW",
        species: "ELECTRIKE",
        level: 13,
        currentHP: 34,
        maxHP: 34,
        moves: [
          {
            name: "TACKLE",
            pp: 35,
          },
          {
            name: "THUNDER_WAVE",
            pp: 20,
          },
          {
            name: "LEER",
            pp: 30,
          },
          {
            name: "HOWL",
            pp: 40,
          },
        ],
      },
      {
        nickname: "GULPIN",
        species: "GULPIN",
        level: 14,
        currentHP: 44,
        maxHP: 44,
        moves: [
          {
            name: "POUND",
            pp: 35,
          },
          {
            name: "YAWN",
            pp: 10,
          },
          {
            name: "POISON_GAS",
            pp: 40,
          },
          {
            name: "SLUDGE",
            pp: 20,
          },
        ],
      },
      {
        nickname: "SEVIPER",
        species: "SEVIPER",
        level: 17,
        currentHP: 56,
        maxHP: 56,
        moves: [
          {
            name: "WRAP",
            pp: 20,
          },
          {
            name: "LICK",
            pp: 30,
          },
          {
            name: "BITE",
            pp: 25,
          },
          {
            name: "POISON_TAIL",
            pp: 25,
          },
        ],
      },
      {
        nickname: " RILL",
        species: "AZUMARILL",
        level: 36,
        currentHP: 131,
        maxHP: 131,
        moves: [
          {
            name: "ROCK_SMASH",
            pp: 15,
          },
          {
            name: "DEFENSE_CURL",
            pp: 40,
          },
          {
            name: "SURF",
            pp: 15,
          },
          {
            name: "DOUBLE_EDGE",
            pp: 15,
          },
        ],
      },
    ],
    money: 20189,
    bag: {
      Items: [
        {
          id: 18,
          name: "PARALYZE_HEAL",
          quantity: 1,
        },
        {
          id: 79,
          name: "X_SPECIAL",
          quantity: 1,
        },
        {
          id: 74,
          name: "DIRE_HIT",
          quantity: 1,
        },
        {
          id: 77,
          name: "X_SPEED",
          quantity: 1,
        },
        {
          id: 63,
          name: "HP_UP",
          quantity: 1,
        },
        {
          id: 35,
          name: "MAX_ETHER",
          quantity: 1,
        },
        {
          id: 182,
          name: "EXP_SHARE",
          quantity: 1,
        },
        {
          id: 64,
          name: "PROTEIN",
          quantity: 1,
        },
        {
          id: 22,
          name: "SUPER_POTION",
          quantity: 13,
        },
        {
          id: 14,
          name: "ANTIDOTE",
          quantity: 3,
        },
        {
          id: 86,
          name: "REPEL",
          quantity: 1,
        },
        {
          id: 78,
          name: "X_ACCURACY",
          quantity: 1,
        },
      ],
      Pokeballs: [
        {
          id: 4,
          name: "POKE_BALL",
          quantity: 20,
        },
        {
          id: 3,
          name: "GREAT_BALL",
          quantity: 10,
        },
        {
          id: 12,
          name: "PREMIER_BALL",
          quantity: 1,
        },
      ],
      "TMs & HMs": [
        {
          id: 296,
          name: "TM08_BULK_UP",
          quantity: 1,
        },
        {
          id: 297,
          name: "TM09_BULLET_SEED",
          quantity: 1,
        },
        {
          id: 322,
          name: "TM34_SHOCK_WAVE",
          quantity: 1,
        },
        {
          id: 327,
          name: "TM39_ROCK_TOMB",
          quantity: 1,
        },
        {
          id: 330,
          name: "TM42_FACADE",
          quantity: 1,
        },
        {
          id: 335,
          name: "TM47_STEEL_WING",
          quantity: 1,
        },
        {
          id: 338,
          name: "TM50_OVERHEAT",
          quantity: 1,
        },
        {
          id: 339,
          name: "HM01_CUT",
          quantity: 1,
        },
        {
          id: 341,
          name: "HM03_SURF",
          quantity: 1,
        },
        {
          id: 342,
          name: "HM04_STRENGTH",
          quantity: 1,
        },
        {
          id: 343,
          name: "HM05_FLASH",
          quantity: 1,
        },
        {
          id: 344,
          name: "HM06_ROCK_SMASH",
          quantity: 1,
        },
      ],
      Berries: [],
      "Key Items": [
        {
          id: 268,
          name: "WAILMER_PAIL",
          quantity: 1,
        },
        {
          id: 261,
          name: "ITEMFINDER",
          quantity: 1,
        },
        {
          id: 259,
          name: "MACH_BIKE",
          quantity: 1,
        },
        {
          id: 279,
          name: "GO_GOGGLES",
          quantity: 1,
        },
        {
          id: 271,
          name: "BASEMENT_KEY",
          quantity: 1,
        },
      ],
    },
    badges: [
      "Stone Badge",
      "Knuckle Badge",
      "Dynamo Badge",
      "Heat Badge",
      "Balance Badge",
    ],
  }
    
    // Simulate receiving data
    window.setTimeout(() => {
        const overlay = new StreamOverlay();
        overlay.updateDisplay(mockData);
    }, 100);
}, 2000);