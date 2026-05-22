// ════════════════════════════════════════════════════════════════════════════════
// BROWSER HISTORY PROTECTION FOR PUBLIC USERS
// Prevents unauthorized access to login pages through browser back navigation
// ════════════════════════════════════════════════════════════════════════════════

const HISTORY_PROTECTION = {
  // Define protected login pages that public users cannot access
  PROTECTED_PAGES: [
    '/index.html',
    '/admin-login.html',
    '/coach-login.html',
    '/referee-login.html',
    '/admin/dashboard.html',
    '/team/dashboard.html',
    '/referee/dashboard.html',
    '/register.html',
    '/'
  ],

  // Define public pages that are allowed for public users
  PUBLIC_PAGES: [
    '/player-register.html',
    '/leaderboard.html',
    '/thank-you.html'
  ],

  // Session key to track if user is in public flow
  SESSION_KEY: 'isPublicUser',
  ENTRY_PAGE_KEY: 'publicEntryPage',

  /**
   * Initialize history protection
   * Call this on DOMContentLoaded in pages that need protection
   */
  init() {
    console.log('🔐 HISTORY_PROTECTION: Initializing browser history protection');

    // Check current page
    const currentPath = window.location.pathname;

    // Mark if user is on a public page
    if (this.isPublicPage(currentPath)) {
      if (!this.hasValidSession()) {
        this.markPublicUser();
        console.log('✅ User is on public page:', currentPath);
      } else {
        this.clearPublicSession();
      }
    }

    // Protect against back navigation to protected pages
    this.setupHistoryListener();
  },

  /**
   * Check if a page path is a public page
   */
  isPublicPage(path) {
    return this.PUBLIC_PAGES.some(publicPath => {
      return path.includes(publicPath) || path === publicPath;
    });
  },

  /**
   * Check if a page path is protected
   */
  isProtectedPage(path) {
    return this.PROTECTED_PAGES.some(protectedPath => {
      return path.includes(protectedPath) || path === protectedPath;
    });
  },

  /**
   * Mark the user as a public user in session
   */
  markPublicUser() {
    sessionStorage.setItem(this.SESSION_KEY, 'true');
    
    // Store the entry page if not already set
    if (!sessionStorage.getItem(this.ENTRY_PAGE_KEY)) {
      sessionStorage.setItem(this.ENTRY_PAGE_KEY, window.location.pathname);
    }

    console.log('✅ Public user marked in session');
  },

  /**
   * Check if user is a public user
   */
  isPublicUser() {
    return sessionStorage.getItem(this.SESSION_KEY) === 'true';
  },

  /**
   * Clear public user session (used when closing page or logging in)
   */
  clearPublicSession() {
    sessionStorage.removeItem(this.SESSION_KEY);
    sessionStorage.removeItem(this.ENTRY_PAGE_KEY);
    console.log('✅ Public user session cleared');
  },

  /**
   * Setup listener for popstate events (back/forward button)
   */
  setupHistoryListener() {
    window.addEventListener('popstate', (event) => {
      console.log('📍 Pop state event triggered');
      this.handleHistoryNavigation();
    });

    console.log('✅ History listener attached');
  },

  /**
   * Handle navigation attempt to protected pages
   */
  handleHistoryNavigation() {
    const currentPath = window.location.pathname;
    const isPublic = this.isPublicUser();
    const isProtected = this.isProtectedPage(currentPath);

    console.log('🔍 Navigation check:', {
      currentPath,
      isPublic,
      isProtected
    });

    // If public user tries to access protected page via back button
    if (isPublic && isProtected) {
      console.warn('⚠️ BLOCKED: Public user attempting to access protected page:', currentPath);
      
      // Redirect to public homepage
      window.location.replace('/player-register.html');
      return;
    }

    // If user somehow got here without proper authentication
    if (isProtected && !this.hasValidSession()) {
      console.warn('⚠️ BLOCKED: Unauthenticated access attempt to:', currentPath);
      window.location.replace('/index.html');
      return;
    }
  },

  /**
   * Check if user has valid authenticated session
   */
  hasValidSession() {
    const userRole = sessionStorage.getItem('userRole');
    const userId = sessionStorage.getItem('userId');
    
    // Valid session has a role and user ID
    const hasSession = userRole && userId && 
                      (userRole === 'admin' || userRole === 'judge' || 
                       userRole === 'team' || userRole === 'referee');

    return hasSession;
  },

  /**
   * Protect page by blocking back navigation
   * Creates unbreakable history states
   */
  protectCurrentPage() {
    // Push multiple history states to prevent accidental back navigation
    for (let i = 0; i < 5; i++) {
      history.pushState(
        { protected: true, index: i },
        '',
        window.location.href
      );
    }

    console.log('🛡️ Current page protected with history barriers');
  },

  /**
   * Block navigation to a specific URL
   */
  blockNavigation(targetUrl) {
    // Check if target is a protected login page
    try {
      const targetPath = new URL(targetUrl, window.location.origin).pathname;
      
      if (this.isPublicUser() && this.isProtectedPage(targetPath)) {
        console.warn('⚠️ Navigation blocked to:', targetUrl);
        return true;
      }
    } catch (e) {
      console.error('Error parsing URL:', e);
    }

    return false;
  },

  /**
   * Verify and enforce public user restrictions on page load
   * Call this on pages that need to verify access
   */
  verifyPageAccess() {
    const currentPath = window.location.pathname;
    const userRole = sessionStorage.getItem('userRole');
    const isPublic = this.isPublicUser();

    console.log('🔐 Verifying page access:', {
      currentPath,
      userRole,
      isPublic
    });

    // If on protected page without proper auth
    if (this.isProtectedPage(currentPath)) {
      // If no user role at all, redirect to login
      if (!userRole) {
        console.warn('❌ No authentication, redirecting to login');
        window.location.replace('/index.html');
        return false;
      }

      // If public user on protected page, redirect to public page
      if (isPublic) {
        console.warn('❌ Public user on protected page, redirecting to public registration');
        window.location.replace('/player-register.html');
        return false;
      }
    }

    console.log('✅ Page access verified');
    return true;
  }
};

// Auto-initialize on DOM ready if not manually called
document.addEventListener('DOMContentLoaded', () => {
  // Only initialize if not already done
  if (typeof window.HISTORY_PROTECTION_INITIALIZED === 'undefined') {
    HISTORY_PROTECTION.init();
    window.HISTORY_PROTECTION_INITIALIZED = true;
  }
}, { once: true });
