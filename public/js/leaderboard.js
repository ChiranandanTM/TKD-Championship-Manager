import '/js/firebase.js';

// Team leaderboard scoring. Both semi-final losers ("1st Bronze" and "2nd
// Bronze") are worth the same amount.
const GOLD_POINTS = 120;
const SILVER_POINTS = 50;
const BRONZE_POINTS = 20;

// Age categories the leaderboard cares about. 'Mini' medals are still stored
// and shown on player-facing pages — they just never contribute leaderboard
// points, in "Overall" or any category filter.
const GENDERS = ['Male', 'Female'];
const AGE_CATEGORIES = ['Sub-Junior', 'Mini', 'Cadet', 'Junior', 'Senior'];
const EXCLUDED_AGE_CATEGORIES = ['Mini'];

const CATEGORY_FILTERS = [
    { value: 'all', label: 'Overall Team Points' },
    { value: 'Male-Sub-Junior', label: 'Sub-Junior Boys Team Points' },
    { value: 'Female-Sub-Junior', label: 'Sub-Junior Girls Team Points' },
    { value: 'Male-Cadet', label: 'Cadet Boys Team Points' },
    { value: 'Female-Cadet', label: 'Cadet Girls Team Points' },
    { value: 'Male-Junior', label: 'Junior Boys Team Points' },
    { value: 'Female-Junior', label: 'Junior Girls Team Points' },
    { value: 'Male-Senior', label: 'Senior Men Team Points' },
    { value: 'Female-Senior', label: 'Senior Women Team Points' }
];

const LEADERBOARD = {
    teams: {},
    brackets: {},
    currentFilter: 'all',

    init() {
        console.log("🏆 Initializing Leaderboard...");

        this.populateFilterOptions();

        const teamsRef = window.dbRef(window.database, 'teams');
        window.dbOnValue(teamsRef, (snapshot) => {
            if (snapshot.exists()) {
                const teamsData = snapshot.val();
                for (const [id, team] of Object.entries(teamsData)) {
                    if (!this.teams[id]) {
                        this.teams[id] = { id: id, name: team.teamName, gold: 0, silver: 0, bronze: 0, points: 0 };
                    } else {
                        this.teams[id].name = team.teamName;
                    }
                }
            }
            this.calculateRankings();
        });

        const bracketsRef = window.dbRef(window.database, 'brackets');
        window.dbOnValue(bracketsRef, (snapshot) => {
            if (snapshot.exists()) {
                this.brackets = snapshot.val();
            } else {
                this.brackets = {};
            }
            this.calculateRankings();
        });
    },

    populateFilterOptions() {
        const select = document.getElementById('categoryFilter');
        if (!select) return;

        select.innerHTML = CATEGORY_FILTERS.map(f => `<option value="${f.value}">${f.label}</option>`).join('');
        select.value = this.currentFilter;
        select.addEventListener('change', (e) => {
            this.currentFilter = e.target.value;
            this.calculateRankings();
        });
    },

    // A bracket's Firebase key is built as `${gender}-${ageCategory}-${weightCategory}`
    // (see bracket.js). Parse it back out so brackets can be matched against
    // the excluded-category list and the category filter.
    parseCategoryKey(categoryKey) {
        const gender = GENDERS.find(g => categoryKey.startsWith(g + '-'));
        if (!gender) return null;

        const rest = categoryKey.slice(gender.length + 1);
        const ageCategory = AGE_CATEGORIES.find(a => rest === a || rest.startsWith(a + '-'));
        if (!ageCategory) return null;

        return { gender, ageCategory };
    },

    // Whether a bracket's medals should count toward leaderboard points under
    // the currently selected filter.
    isCategoryScored(categoryKey) {
        const parsed = this.parseCategoryKey(categoryKey);

        // Unrecognized key format (legacy data): don't silently drop it from
        // the overall leaderboard, but it can never match a specific filter.
        if (!parsed) {
            return this.currentFilter === 'all';
        }

        if (EXCLUDED_AGE_CATEGORIES.includes(parsed.ageCategory)) return false;

        if (this.currentFilter === 'all') return true;
        return `${parsed.gender}-${parsed.ageCategory}` === this.currentFilter;
    },

    getTeam(player) {
        if (!player) return null;

        let teamId = player.teamId;
        // If no teamId but we have teamName, try to find the team or create a generic one
        if (!teamId && player.teamName) {
            // Check if we have a team with this name
            const found = Object.values(this.teams).find(t => t.name === player.teamName);
            if (found) {
                teamId = found.id;
            } else {
                teamId = 'generic_' + player.teamName.toLowerCase().replace(/\s+/g, '_');
                if (!this.teams[teamId]) {
                    this.teams[teamId] = { id: teamId, name: player.teamName, gold: 0, silver: 0, bronze: 0, points: 0 };
                }
            }
        }
        return teamId ? this.teams[teamId] : null;
    },

    calculateRankings() {
        // Reset scores
        Object.values(this.teams).forEach(t => {
            t.gold = 0;
            t.silver = 0;
            t.bronze = 0;
            t.points = 0;
        });

        // Iterate brackets
        for (const [categoryKey, bracket] of Object.entries(this.brackets)) {
            // Only count brackets that are fully complete
            if (bracket.status !== 'complete') {
                continue;
            }

            // Excluded age category (Mini) or doesn't match the active
            // category filter — medals still exist elsewhere, just not here.
            if (!this.isCategoryScored(categoryKey)) {
                continue;
            }

            // Detect single-player walkover: rounds may be missing, empty [],
            // [[]] (one round with zero matches), or Firebase object equivalents.
            // Also detect via bracket.status + byePlayers as a fallback.
            const roundsRaw = bracket.rounds;
            let roundsArr;
            if (Array.isArray(roundsRaw)) {
                roundsArr = roundsRaw;
            } else if (roundsRaw && typeof roundsRaw === 'object') {
                roundsArr = Object.keys(roundsRaw).sort((a, b) => Number(a) - Number(b)).map(k => roundsRaw[k]);
            } else {
                roundsArr = [];
            }

            const hasActualMatches = roundsArr.some(r => {
                if (!r) return false;
                const ra = Array.isArray(r) ? r : Object.values(r);
                return ra.length > 0;
            });

            if (!hasActualMatches) {
                // Single-player walkover: award gold to the bye player's team
                const byePlayers = bracket.byePlayers || {};
                const byePlayer = byePlayers['0'] || byePlayers[0];
                if (byePlayer) {
                    const champTeam = this.getTeam(byePlayer);
                    if (champTeam) {
                        champTeam.gold += 1;
                        champTeam.points += GOLD_POINTS;
                        console.log(`🏆 Walkover gold awarded to ${champTeam.name} in ${categoryKey}`);
                    }
                }
                continue;
            }

            const totalRounds = roundsArr.length;

            // Final Match (Gold & Silver)
            const finalRound = roundsArr[totalRounds - 1];
            if (finalRound && finalRound.length > 0) {
                const finalMatch = finalRound[0];
                if (finalMatch && finalMatch.status === 'completed' && finalMatch.winner) {
                    const champion = finalMatch.player1 && finalMatch.player1.id === finalMatch.winner ? finalMatch.player1 : finalMatch.player2;
                    const runnerUp = finalMatch.player1 && finalMatch.player1.id === finalMatch.winner ? finalMatch.player2 : finalMatch.player1;

                    const champTeam = this.getTeam(champion);
                    if (champTeam) {
                        champTeam.gold += 1;
                        champTeam.points += GOLD_POINTS;
                    }

                    const runnerUpTeam = this.getTeam(runnerUp);
                    if (runnerUpTeam) {
                        runnerUpTeam.silver += 1;
                        runnerUpTeam.points += SILVER_POINTS;
                    }
                }
            }

            // Semi-Final Matches (1st Bronze & 2nd Bronze — both worth the same)
            if (totalRounds >= 2) {
                const semiRound = roundsArr[totalRounds - 2];
                if (semiRound) {
                    semiRound.forEach(match => {
                        if (match && match.status === 'completed' && match.winner && match.eliminated) {
                            const loser = match.player1 && match.player1.id === match.eliminated ? match.player1 : match.player2;
                            const bronzeTeam = this.getTeam(loser);
                            if (bronzeTeam) {
                                bronzeTeam.bronze += 1;
                                bronzeTeam.points += BRONZE_POINTS;
                            }
                        }
                    });
                }
            }
        }

        // Filter out teams with 0 points and sort
        const rankedTeams = Object.values(this.teams)
            .filter(t => t.points > 0)
            .sort((a, b) => {
                // Primary: Total Points
                if (b.points !== a.points) return b.points - a.points;
                // Tiebreaker 1: Gold
                if (b.gold !== a.gold) return b.gold - a.gold;
                // Tiebreaker 2: Silver
                if (b.silver !== a.silver) return b.silver - a.silver;
                // Tiebreaker 3: Bronze
                return b.bronze - a.bronze;
            });

        this.render(rankedTeams);
    },

    render(rankedTeams) {
        const tbody = document.getElementById('leaderboardBody');
        if (!tbody) return;

        if (rankedTeams.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="6" class="loader" style="padding: 60px;">
                        <div style="font-size: 2rem; margin-bottom: 15px;">🥋</div>
                        No completed matches yet.<br>Results will appear here as the tournament progresses.
                    </td>
                </tr>
            `;
            return;
        }

        let html = '';
        rankedTeams.forEach((team, index) => {
            const rank = index + 1;
            let rankClass = '';
            if (rank === 1) rankClass = 'rank-1';
            else if (rank === 2) rankClass = 'rank-2';
            else if (rank === 3) rankClass = 'rank-3';

            html += `
                <tr class="${rankClass}">
                    <td class="rank">${rank === 1 ? '🥇 1' : rank === 2 ? '🥈 2' : rank === 3 ? '🥉 3' : rank}</td>
                    <td class="team-name">${team.name}</td>
                    <td class="center" style="font-weight: 700; color: #FFD700">${team.gold}</td>
                    <td class="center" style="font-weight: 700; color: #C0C0C0">${team.silver}</td>
                    <td class="center" style="font-weight: 700; color: #CD7F32">${team.bronze}</td>
                    <td class="center">
                        <span class="points-box">${team.points}</span>
                    </td>
                </tr>
            `;
        });

        tbody.innerHTML = html;
    }
};

window.addEventListener('DOMContentLoaded', () => {
    // Adding a slight delay to allow Firebase to initialize via module
    setTimeout(() => {
        if (window.database) {
            LEADERBOARD.init();
        } else {
            console.error("Firebase database not found on window object.");
        }
    }, 500);
});
