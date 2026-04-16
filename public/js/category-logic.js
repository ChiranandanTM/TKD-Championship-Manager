// ============================================
// CATEGORY LOGIC - AGE & WEIGHT CALCULATION
// ============================================

const CATEGORY_LOGIC = {
  
  // Default weight categories (admin can modify)
  defaultWeightCategories: {
    // MALE CATEGORIES
    'Male-Mini': [
      { min: 0, max: 20, label: 'Under 20kg' },
      { min: 20, max: 25, label: '20-25kg' },
      { min: 25, max: 30, label: '25-30kg' },
      { min: 30, max: 35, label: '30-35kg' },
      { min: 35, max: 999, label: 'Above 35kg' }
    ],
    'Male-Sub-Junior': [
      { min: 0, max: 25, label: 'Under 25kg' },
      { min: 25, max: 30, label: '25-30kg' },
      { min: 30, max: 35, label: '30-35kg' },
      { min: 35, max: 40, label: '35-40kg' },
      { min: 40, max: 45, label: '40-45kg' },
      { min: 45, max: 999, label: 'Above 45kg' }
    ],
    'Male-Junior': [
      { min: 0, max: 40, label: 'Under 40kg' },
      { min: 40, max: 45, label: '40-45kg' },
      { min: 45, max: 50, label: '45-50kg' },
      { min: 50, max: 55, label: '50-55kg' },
      { min: 55, max: 60, label: '55-60kg' },
      { min: 60, max: 65, label: '60-65kg' },
      { min: 65, max: 999, label: 'Above 65kg' }
    ],
    'Male-Cadet': [
      { min: 0, max: 45, label: 'Under 45kg' },
      { min: 45, max: 50, label: '45-50kg' },
      { min: 50, max: 55, label: '50-55kg' },
      { min: 55, max: 60, label: '55-60kg' },
      { min: 60, max: 65, label: '60-65kg' },
      { min: 65, max: 70, label: '65-70kg' },
      { min: 70, max: 999, label: 'Above 70kg' }
    ],
    'Male-Senior': [
      { min: 0, max: 54, label: 'Fin Weight (Under 54kg)' },
      { min: 54, max: 58, label: 'Fly Weight (54-58kg)' },
      { min: 58, max: 63, label: 'Bantam Weight (58-63kg)' },
      { min: 63, max: 68, label: 'Feather Weight (63-68kg)' },
      { min: 68, max: 74, label: 'Light Weight (68-74kg)' },
      { min: 74, max: 80, label: 'Welter Weight (74-80kg)' },
      { min: 80, max: 87, label: 'Middle Weight (80-87kg)' },
      { min: 87, max: 999, label: 'Heavy Weight (Above 87kg)' }
    ],

    // FEMALE CATEGORIES
    'Female-Mini': [
      { min: 0, max: 20, label: 'Under 20kg' },
      { min: 20, max: 25, label: '20-25kg' },
      { min: 25, max: 30, label: '25-30kg' },
      { min: 30, max: 999, label: 'Above 30kg' }
    ],
    'Female-Sub-Junior': [
      { min: 0, max: 25, label: 'Under 25kg' },
      { min: 25, max: 30, label: '25-30kg' },
      { min: 30, max: 35, label: '30-35kg' },
      { min: 35, max: 40, label: '35-40kg' },
      { min: 40, max: 999, label: 'Above 40kg' }
    ],
    'Female-Junior': [
      { min: 0, max: 40, label: 'Under 40kg' },
      { min: 40, max: 44, label: '40-44kg' },
      { min: 44, max: 47, label: '44-47kg' },
      { min: 47, max: 51, label: '47-51kg' },
      { min: 51, max: 55, label: '51-55kg' },
      { min: 55, max: 59, label: '55-59kg' },
      { min: 59, max: 999, label: 'Above 59kg' }
    ],
    'Female-Cadet': [
      { min: 0, max: 44, label: 'Under 44kg' },
      { min: 44, max: 47, label: '44-47kg' },
      { min: 47, max: 51, label: '47-51kg' },
      { min: 51, max: 55, label: '51-55kg' },
      { min: 55, max: 59, label: '55-59kg' },
      { min: 59, max: 63, label: '59-63kg' },
      { min: 63, max: 999, label: 'Above 63kg' }
    ],
    'Female-Senior': [
      { min: 0, max: 46, label: 'Fin Weight (Under 46kg)' },
      { min: 46, max: 49, label: 'Fly Weight (46-49kg)' },
      { min: 49, max: 53, label: 'Bantam Weight (49-53kg)' },
      { min: 53, max: 57, label: 'Feather Weight (53-57kg)' },
      { min: 57, max: 62, label: 'Light Weight (57-62kg)' },
      { min: 62, max: 67, label: 'Welter Weight (62-67kg)' },
      { min: 67, max: 73, label: 'Middle Weight (67-73kg)' },
      { min: 73, max: 999, label: 'Heavy Weight (Above 73kg)' }
    ]
  },

  // Calculate age from DOB
  calculateAge(dob) {
    const birthDate = new Date(dob);
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }
    
    return age;
  },

  // Determine age category
  getAgeCategory(age) {
    if (age >= 0 && age <= 7) return 'Mini';
    if (age >= 8 && age <= 11) return 'Sub-Junior';
    if (age >= 12 && age <= 14) return 'Cadet';
    if (age >= 15 && age <= 17) return 'Junior';
    if (age >= 18) return 'Senior';
    return 'Unknown';
  },

  // Get weight category based on gender, age category, and weight
  async getWeightCategory(gender, ageCategories, weight) {
    try {
      // If any parameter is invalid, return empty string
      if (!gender || !ageCategories || !Array.isArray(ageCategories) || ageCategories.length === 0 || !weight || weight <= 0) {
        console.warn("⚠️ Invalid parameters for weight category:", { gender, ageCategories, weight });
        return '';
      }

      // Load weight categories from Firebase (or use default)
      let weightCategories = this.defaultWeightCategories;
      
      try {
        const categoriesRef = dbRef(database, 'weightCategories');
        const snapshot = await dbGet(categoriesRef);
        if (snapshot.exists()) {
          weightCategories = snapshot.val();
          console.log("📥 Loaded weight categories from Firebase");
        }
      } catch (dbError) {
        // If Firebase fails, use default categories
        console.warn("⚠️ Using default weight categories (Firebase load failed):", dbError.message);
      }

      // Find the first matching category
      for (let category of ageCategories) {
        const key = `${gender}-${category}`;
        const ranges = weightCategories[key];
        
        console.log(`🔍 Looking for weight category with key: ${key}`);
        
        if (ranges && Array.isArray(ranges)) {
          for (let range of ranges) {
            if (weight >= range.min && weight < range.max) {
              console.log(`✅ Found weight category: ${range.label}`);
              return range.label;
            }
          }
        }
      }
      
      console.warn(`⚠️ No weight range found for ${gender}-${ageCategories[0]} ${weight}kg`);
      return 'Not Assigned';
    } catch (error) {
      console.error("❌ Error getting weight category:", error);
      return 'Error'; // Return "Error" instead of empty string to indicate a failure
    }
  },

  // Save weight categories to Firebase
  async saveWeightCategories(categories) {
    try {
      const categoriesRef = dbRef(database, 'weightCategories');
      await dbSet(categoriesRef, categories);
      console.log("✅ Weight categories saved");
      return true;
    } catch (error) {
      console.error("❌ Error saving weight categories:", error);
      return false;
    }
  },

  // Load weight categories
  async loadWeightCategories() {
    try {
      const categoriesRef = dbRef(database, 'weightCategories');
      const snapshot = await dbGet(categoriesRef);
      
      if (snapshot.exists()) {
        return snapshot.val();
      } else {
        await this.saveWeightCategories(this.defaultWeightCategories);
        return this.defaultWeightCategories;
      }
    } catch (error) {
      console.error("❌ Error loading weight categories:", error);
      return this.defaultWeightCategories;
    }
  }
};

window.CATEGORY_LOGIC = CATEGORY_LOGIC;