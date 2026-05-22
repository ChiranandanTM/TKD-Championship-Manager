import '/js/firebase.js';

const LEADERBOARD = {
    teams: {},
    brackets: {},

    init() {
        console.log("🏆 Initializing Leaderboard...");
        
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
            if (!bracket.rounds || bracket.rounds.length === 0) continue;
            
            const totalRounds = bracket.rounds.length;
            
            // Final Match (Gold & Silver)
            const finalRound = bracket.rounds[totalRounds - 1];
            if (finalRound && finalRound.length > 0) {
                const finalMatch = finalRound[0];
                if (finalMatch && finalMatch.status === 'completed' && finalMatch.winner) {
                    const champion = finalMatch.player1 && finalMatch.player1.id === finalMatch.winner ? finalMatch.player1 : finalMatch.player2;
                    const runnerUp = finalMatch.player1 && finalMatch.player1.id === finalMatch.winner ? finalMatch.player2 : finalMatch.player1;
                    
                    const champTeam = this.getTeam(champion);
                    if (champTeam) {
                        champTeam.gold += 1;
                        champTeam.points += 7;
                    }
                    
                    const runnerUpTeam = this.getTeam(runnerUp);
                    if (runnerUpTeam) {
                        runnerUpTeam.silver += 1;
                        runnerUpTeam.points += 3;
                    }
                }
            }

            // Semi-Final Matches (Bronze)
            if (totalRounds >= 2) {
                const semiRound = bracket.rounds[totalRounds - 2];
                if (semiRound) {
                    semiRound.forEach(match => {
                        if (match && match.status === 'completed' && match.winner && match.eliminated) {
                            const loser = match.player1 && match.player1.id === match.eliminated ? match.player1 : match.player2;
                            const bronzeTeam = this.getTeam(loser);
                            if (bronzeTeam) {
                                bronzeTeam.bronze += 1;
                                bronzeTeam.points += 1;
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
