class StreamOverlay {
  constructor() {
    this.ws = null;
    this.reconnectInterval = 5000;
    this.lastData = null;
    this.lastInventoryCategories = {}; // Store previous inventory state per category
    this.commentaryHistory = []; // Stores commentary entries
    this.maxCommentaryItems = 10; // Max number of commentary items to display
    this.init();
  }

  init() {
    this.connectWebSocket();
    this.startPolling();
  }

  connectWebSocket() {
    try {
      this.ws = new WebSocket("ws://localhost:8080");

      this.ws.onopen = () => {
        console.log("WebSocket connected");
        this.setStatus("Connected", "success");
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.updateDisplay(data);
        } catch (error) {
          console.error("Error parsing WebSocket data:", error);
        }
      };

      this.ws.onclose = () => {
        console.log("WebSocket disconnected, attempting to reconnect...");
        this.setStatus("Disconnected", "error");
        setTimeout(() => this.connectWebSocket(), this.reconnectInterval);
      };

      this.ws.onerror = (error) => {
        console.error("WebSocket error:", error);
        this.setStatus("Error", "error");
        // Attempt to reconnect on error as well
        if (this.ws) this.ws.close(); // Ensure it's closed before trying to reconnect
      };
    } catch (error) {
      console.error("Failed to create WebSocket:", error);
      this.setStatus("Connection Failed", "error");
    }
  }

  async startPolling() {
    setInterval(async () => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
          console.warn("Polling: WebSocket not open or not available. Waiting for reconnect.");
          // this.setStatus("Polling Connection Failed", "error"); // Status is likely already handled by onclose/onerror
      }
    }, 2000);
  }

  updateDisplay(data) {
    this.lastData = data;
    const commentaryDisplay = document.getElementById("commentary-display");

    // Update commentary
    if (data.commentary) {
      // Add new commentary to the history
      this.commentaryHistory.push(data.commentary);
      // If history exceeds max length, remove the oldest (first) item
      if (this.commentaryHistory.length > this.maxCommentaryItems) {
        this.commentaryHistory.shift();
      }

      // Re-render all commentary items
      commentaryDisplay.innerHTML = ''; // Clear previous items
      this.commentaryHistory.forEach((text, index) => {
        const commentaryItem = document.createElement('div');
        commentaryItem.className = 'commentary-item';
        // Add a special class if this is the most recent item
        if (index === this.commentaryHistory.length - 1) {
          commentaryItem.classList.add('latest-commentary');
        }
        commentaryItem.textContent = text;
        commentaryDisplay.appendChild(commentaryItem); // New items added to the end (bottom due to CSS)
      });
       // Scroll to the bottom of the commentary box
       commentaryDisplay.scrollTop = commentaryDisplay.scrollHeight;
    }


    // Update navigation
    if (data.navigation && Array.isArray(data.navigation)) {
      const navText =
        data.navigation.length > 0
          ? data.navigation
              .slice(0, 5) // Keep showing a preview of the path
              .map((coord) => `[${coord.x},${coord.y}]`)
              .join(" → ") + (data.navigation.length > 5 ? " ..." : "")
          : "No path planned";
      document.getElementById("navigation-display").textContent = navText;
    }

    // Update goals
    if (data.goalLongTerm) {
      document.getElementById("goal-long").textContent = data.goalLongTerm;
    }
    if (data.goalMidTerm) {
      document.getElementById("goal-mid").textContent = data.goalMidTerm;
    }
    if (data.goalShortTerm) {
      document.getElementById("goal-short").textContent = data.goalShortTerm;
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
    if (typeof data.money === "number") {
      document.getElementById(
        "money-display"
      ).textContent = `💰 $${data.money.toLocaleString()}`;
    }
  }

  updateParty(pokemon) {
    const partyDisplay = document.getElementById("party-display");
    partyDisplay.innerHTML = ""; // Clear previous items

    pokemon.forEach((mon) => {
      if (mon && mon.species) {
        const pokemonCard = document.createElement("div");
        const isFainted = mon.currentHP === 0;
        pokemonCard.className = "pokemon-card" + (isFainted ? " fainted" : "");

        const displayName = mon.nickname || mon.species;

        const hpPercent = mon.maxHP > 0 ? (mon.currentHP / mon.maxHP) * 100 : 0;
        let hpClass = "";
        if (hpPercent <= 25) hpClass = "hp-red";
        else if (hpPercent <= 50) hpClass = "hp-yellow";

        pokemonCard.innerHTML = `
                            <div class="pokemon-name">${displayName}</div>
                            <div class="pokemon-level">Lv.${mon.level || "?"} ${
          mon.species || "Unknown"
        }</div>
                            <div class="pokemon-hp-container">
                                <div class="pokemon-hp-text">HP: ${
                                  mon.currentHP || 0
                                }/${mon.maxHP || "?"}</div>
                                <div class="pokemon-hp-bar">
                                    <div class="pokemon-hp-fill ${hpClass}" style="width: ${hpPercent}%"></div>
                                </div>
                            </div>
                            ${
                              isFainted
                                ? '<div class="fainted-indicator">Fainted</div>'
                                : ""
                            }
                        `;
        partyDisplay.appendChild(pokemonCard);
      }
    });
  }

  _createInventoryItemElement(item) {
    const itemElement = document.createElement("div");
    itemElement.className = "inventory-item";

    const itemName = document.createElement("span");
    itemName.className = "item-name";
    itemName.textContent = item.name;
    itemName.title = item.name; // Tooltip for full name

    const itemQuantity = document.createElement("span");
    itemQuantity.textContent = `x${item.quantity}`;

    itemElement.appendChild(itemName);
    itemElement.appendChild(itemQuantity);
    return itemElement;
  }


  updateInventory(bag) {
    const categories = [
      { name: "Items", id: "items" },
      { name: "Pokeballs", id: "pokeballs" },
      { name: "TMs & HMs", id: "tms" },
      { name: "Berries", id: "berries" },
      { name: "Key Items", id: "keyitems" }
    ];

    categories.forEach((category) => {
      const currentItems = bag[category.name] || [];
      const previousItems = this.lastInventoryCategories[category.name] || [];
      const wrapper = document.getElementById(`${category.id}-wrapper`);

      if (!wrapper) {
        console.warn(`Inventory wrapper for ${category.id}-wrapper not found.`);
        return;
      }

      // Only update DOM if items have actually changed for this category
      if (JSON.stringify(currentItems) !== JSON.stringify(previousItems)) {
        // console.log(`Inventory category '${category.name}' changed. Updating.`);
        wrapper.innerHTML = ""; // Clear previous items for this specific category

        if (currentItems.length === 0) {
          const emptyDiv = document.createElement("div");
          emptyDiv.className = "empty-inventory";
          emptyDiv.textContent = `No ${category.name.toLowerCase()}`;
          wrapper.appendChild(emptyDiv);
          wrapper.style.animation = "none"; // Stop animation if empty
        } else {
          currentItems.forEach((item) => {
            wrapper.appendChild(this._createInventoryItemElement(item));
          });

          // Handle scrolling animation
          if (currentItems.length > 8) { // Threshold for scrolling
            // Duplicate items for seamless scrolling
            currentItems.forEach((item) => {
              wrapper.appendChild(this._createInventoryItemElement(item));
            });

            const duration = Math.max(20, currentItems.length * 4); // Adjust animation duration
            
            // Reset animation properties to ensure they are correctly applied
            wrapper.style.animation = 'none'; // Clear all animation properties
            void wrapper.offsetWidth; // Force reflow/repaint

            wrapper.style.animationName = "scrollAllInventory";
            wrapper.style.animationDuration = `${duration}s`;
            wrapper.style.animationIterationCount = 'infinite'; // Ensure it loops
            wrapper.style.animationTimingFunction = 'linear';   // For smooth, constant speed
            wrapper.style.animationPlayState = 'running';     // Ensure it's running
          } else {
            wrapper.style.animation = "none"; // No animation for short lists
          }
        }
        // Update the stored state for this category
        this.lastInventoryCategories[category.name] = JSON.parse(JSON.stringify(currentItems));
      }
    });
  }

  updateBadges(badges) {
    const badgeElements = document.querySelectorAll(".badge");
    const badgeNames = [
      "Stone Badge", "Knuckle Badge", "Dynamo Badge", "Heat Badge",
      "Balance Badge", "Feather Badge", "Mind Badge", "Rain Badge",
    ];

    badgeElements.forEach((badgeElement, index) => {
      const badgeName = badgeNames[index];
      if (badges.includes(badgeName)) {
        badgeElement.classList.add("obtained");
      } else {
        badgeElement.classList.remove("obtained");
      }
    });
  }

  setStatus(status, type) {
    console.log(`Status: ${status} (${type})`);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  new StreamOverlay();
});
