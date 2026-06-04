/**
 * Favethemes License Manager - Admin JavaScript
 * Simplified flow: Single "Connect & Activate" button
 */

(function($) {
    'use strict';

    /**
     * Main Admin Controller
     */
    const FLMAdmin = {

        /**
         * Initialize the admin interface
         */
        init: function() {
            this.cacheDom();
            this.bindEvents();
        },

        /**
         * Cache DOM elements
         */
        cacheDom: function() {
            this.$connectBtn = $('#flm-connect-activate');
            this.$checkStatusBtn = $('.flm-check-status-link');
            this.$deactivateBtn = $('.flm-deactivate-link, .flm-deactivate-button');
            this.$forceDeactivateBtn = $('.flm-force-deactivate-link');
            this.$deactivateModal = $('#flm-deactivate-modal');
            this.$forceDeactivateModal = $('#flm-force-deactivate-modal');
            this.$modalClose = $('.flm-modal-close, .flm-modal-cancel');
            this.$confirmDeactivate = $('[data-action="confirm-deactivate"]');
            this.$confirmForceDeactivate = $('[data-action="confirm-force-deactivate"]');
            this.$noticeDismiss = $('.flm-notice-dismiss');
        },

        /**
         * Bind event handlers
         */
        bindEvents: function() {
            // Connect & Activate button
            this.$connectBtn.on('click', this.handleConnect.bind(this));

            // Check Status
            this.$checkStatusBtn.on('click', this.handleCheckStatus.bind(this));

            // Deactivation
            this.$deactivateBtn.on('click', this.showDeactivateModal.bind(this));
            this.$confirmDeactivate.on('click', this.handleDeactivation.bind(this));

            // Force Deactivation
            this.$forceDeactivateBtn.on('click', this.showForceDeactivateModal.bind(this));
            this.$confirmForceDeactivate.on('click', this.handleForceDeactivation.bind(this));

            // Modal close buttons
            this.$modalClose.on('click', this.hideAllModals.bind(this));

            // Notice dismiss
            this.$noticeDismiss.on('click', this.hideNotice.bind(this));

            // Close modals on overlay click
            this.$deactivateModal.find('.flm-modal-overlay').on('click', this.hideDeactivateModal.bind(this));
            this.$forceDeactivateModal.find('.flm-modal-overlay').on('click', this.hideForceDeactivateModal.bind(this));

            // Close modals on escape key
            $(document).on('keydown', this.handleEscapeKey.bind(this));
        },

        /**
         * Handle Connect & Activate button click
         */
        handleConnect: function(e) {
            e.preventDefault();
            const $button = this.$connectBtn;

            // Show loading state
            this.setButtonLoading($button, true);

            // AJAX request to get OAuth URL
            $.ajax({
                url: ajaxurl,
                type: 'POST',
                data: {
                    action: 'flm_get_oauth_url',
                    nonce: flmAdmin.nonce
                },
                success: (response) => {
                    if (response.success && response.data.url) {
                        // Open portal in new tab
                        window.open(response.data.url, '_blank');
                        this.setButtonLoading($button, false);
                    } else {
                        this.setButtonLoading($button, false);
                        this.showNotice('error', response.data.message || 'Failed to connect to portal. Please try again.');
                    }
                },
                error: (xhr, status, error) => {
                    this.setButtonLoading($button, false);
                    this.showNotice('error', 'An error occurred. Please try again.');
                    console.error('Connect error:', error);
                }
            });
        },

        /**
         * Handle Check Status button click
         */
        handleCheckStatus: function(e) {
            e.preventDefault();
            const $button = this.$checkStatusBtn;
            this.setButtonLoading($button, true);
            $.ajax({
                url: ajaxurl,
                type: 'POST',
                data: {
                    action: 'flm_verify_status',
                    nonce: flmAdmin.nonce
                },
                success: (response) => {
                    this.setButtonLoading($button, false);
                    if (response.success) {
                        this.showNotice('success', response.data.message || 'License is valid and active.');
                    } else {
                        var code = response.data.code || '';
                        var clearCodes = ['LICENSE_EXPIRED', 'LICENSE_REVOKED', 'ACTIVATION_NOT_FOUND', 'ACTIVATION_DEACTIVATED'];

                        if (code === 'ACTIVATION_DEACTIVATED') {
                            this.showNotice('success', 'This site was deactivated from the portal. Local license data has been cleared.');
                        } else {
                            this.showNotice('error', response.data.message || 'License verification failed.');
                        }

                        if (clearCodes.indexOf(code) !== -1) {
                            setTimeout(() => { window.location.reload(); }, 4000);
                        }
                    }
                },
                error: (xhr, status, error) => {
                    this.setButtonLoading($button, false);
                    this.showNotice('error', 'An error occurred. Please try again.');
                }
            });
        },

        /**
         * Show deactivate confirmation modal
         */
        showDeactivateModal: function(e) {
            e.preventDefault();
            this.$deactivateModal.fadeIn(200);
            $('body').addClass('modal-open');
        },

        /**
         * Hide deactivate modal
         */
        hideDeactivateModal: function(e) {
            if (e) {
                e.preventDefault();
            }
            this.$deactivateModal.fadeOut(200);
            $('body').removeClass('modal-open');
        },

        /**
         * Show force deactivate confirmation modal
         */
        showForceDeactivateModal: function(e) {
            e.preventDefault();
            this.$forceDeactivateModal.fadeIn(200);
            $('body').addClass('modal-open');
        },

        /**
         * Hide force deactivate modal
         */
        hideForceDeactivateModal: function(e) {
            if (e) {
                e.preventDefault();
            }
            this.$forceDeactivateModal.fadeOut(200);
            $('body').removeClass('modal-open');
        },

        /**
         * Hide all modals
         */
        hideAllModals: function(e) {
            if (e) {
                e.preventDefault();
            }
            this.$deactivateModal.fadeOut(200);
            this.$forceDeactivateModal.fadeOut(200);
            $('body').removeClass('modal-open');
        },

        /**
         * Handle license deactivation
         */
        handleDeactivation: function(e) {
            e.preventDefault();
            const $button = $(e.currentTarget);

            // Show loading state
            this.setButtonLoading($button, true);

            // AJAX request
            $.ajax({
                url: ajaxurl,
                type: 'POST',
                data: {
                    action: 'flm_deactivate',
                    nonce: flmAdmin.nonce
                },
                success: (response) => {
                    this.setButtonLoading($button, false);

                    if (response.success) {
                        this.hideDeactivateModal();
                        this.showNotice('success', response.data.message || 'License deactivated successfully.');

                        // Reload page after 1.5 seconds
                        setTimeout(() => {
                            window.location.reload();
                        }, 1500);
                    } else {
                        this.hideDeactivateModal();

                        // If server suggests force option, show the Force Clear button
                        let errorMsg = response.data.message || 'Deactivation failed. Please try again.';
                        if (response.data.show_force_option) {
                            errorMsg += ' You can use "Force Clear" to remove local license data.';
                            this.showForceClearButton();
                        }

                        this.showNotice('error', errorMsg);
                    }
                },
                error: (xhr, status, error) => {
                    this.setButtonLoading($button, false);
                    this.hideDeactivateModal();
                    this.showNotice('error', 'An error occurred. You can use "Force Clear" to remove local license data.');
                    this.showForceClearButton();
                    console.error('Deactivation error:', error);
                }
            });
        },

        /**
         * Handle force license deactivation (local only)
         */
        handleForceDeactivation: function(e) {
            e.preventDefault();
            const $button = $(e.currentTarget);

            // Show loading state
            this.setButtonLoading($button, true);

            // AJAX request - force deactivate only clears local data
            $.ajax({
                url: ajaxurl,
                type: 'POST',
                data: {
                    action: 'flm_force_deactivate',
                    nonce: flmAdmin.nonce
                },
                success: (response) => {
                    this.setButtonLoading($button, false);

                    if (response.success) {
                        this.hideForceDeactivateModal();
                        this.showNotice('success', response.data.message || 'License data cleared successfully.');

                        // Reload page after 1.5 seconds
                        setTimeout(() => {
                            window.location.reload();
                        }, 1500);
                    } else {
                        this.hideForceDeactivateModal();
                        this.showNotice('error', response.data.message || 'Failed to clear license data.');
                    }
                },
                error: (xhr, status, error) => {
                    this.setButtonLoading($button, false);
                    this.hideForceDeactivateModal();
                    this.showNotice('error', 'An error occurred. Please try again.');
                    console.error('Force deactivation error:', error);
                }
            });
        },

        /**
         * Set button loading state
         */
        setButtonLoading: function($button, loading) {
            if (loading) {
                $button.addClass('loading').prop('disabled', true);
                $button.find('.flm-button-text').hide();
                $button.find('.flm-button-loader').show();
            } else {
                $button.removeClass('loading').prop('disabled', false);
                $button.find('.flm-button-text').show();
                $button.find('.flm-button-loader').hide();
            }
        },

        /**
         * Show notice message
         */
        showNotice: function(type, message) {
            const $notice = $('[data-notice="' + type + '"]');

            $notice.find('.flm-notice-message').text(message);
            $notice.fadeIn(300);

            // Auto-hide success notices after 5 seconds
            if (type === 'success') {
                setTimeout(() => {
                    $notice.fadeOut(200);
                }, 5000);
            }

            // Scroll to notice
            $('html, body').animate({
                scrollTop: $notice.offset().top - 100
            }, 300);
        },

        /**
         * Hide notice message
         */
        hideNotice: function(e) {
            if (e) {
                e.preventDefault();
            }
            $(e.currentTarget).closest('.flm-notice').fadeOut(200);
        },

        /**
         * Show Force Clear button (after deactivation fails)
         */
        showForceClearButton: function() {
            $('#flm-force-clear-btn').fadeIn(200);
        },

        /**
         * Handle escape key for modals
         */
        handleEscapeKey: function(e) {
            if (e.key === 'Escape') {
                if (this.$deactivateModal.is(':visible')) {
                    this.hideDeactivateModal();
                }
                if (this.$forceDeactivateModal.is(':visible')) {
                    this.hideForceDeactivateModal();
                }
            }
        }
    };

    /**
     * URL Parameter Handler
     */
    const URLHandler = {
        /**
         * Check for success/error messages in URL parameters
         */
        checkURLParams: function() {
            const urlParams = new URLSearchParams(window.location.search);

            // Check for activation success
            if (urlParams.get('activated') === '1') {
                FLMAdmin.showNotice('success', 'License activated successfully!');
                this.cleanURL();
            }

            // Check for activation error
            if (urlParams.get('activation_error')) {
                const errorMessage = decodeURIComponent(urlParams.get('activation_error'));
                FLMAdmin.showNotice('error', errorMessage);
                this.cleanURL();
            }
        },

        /**
         * Remove URL parameters without page reload
         */
        cleanURL: function() {
            if (window.history && window.history.replaceState) {
                const cleanURL = window.location.pathname + '?page=favethemes-license';
                window.history.replaceState({}, document.title, cleanURL);
            }
        }
    };

    /**
     * Accessibility Enhancements
     */
    const A11y = {
        /**
         * Initialize accessibility features
         */
        init: function() {
            this.addAriaLabels();
        },

        /**
         * Add ARIA labels for better screen reader support
         */
        addAriaLabels: function() {
            $('.flm-notice-dismiss').attr('aria-label', 'Dismiss notice');
            $('.flm-modal-close').attr('aria-label', 'Close modal');
            $('#flm-connect-activate').attr('aria-label', 'Connect and activate your license');
        }
    };

    /**
     * Initialize on document ready
     */
    $(document).ready(function() {
        FLMAdmin.init();
        URLHandler.checkURLParams();
        A11y.init();
    });

    /**
     * Expose to global scope for testing/debugging
     */
    window.FLMAdmin = FLMAdmin;

})(jQuery);
