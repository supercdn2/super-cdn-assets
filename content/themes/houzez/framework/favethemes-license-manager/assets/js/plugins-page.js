/**
 * Favethemes Portal Plugins Page JavaScript
 */
(function($) {
    'use strict';

    // Plugin data storage
    let pluginsData = [];
    let currentFilter = 'all';

    // Per-plugin queues for serializing same-plugin operations while allowing cross-plugin concurrency
    let pluginQueues = new Map(); // Map<slug, { active: bool, queue: [], overlayText: string|null }>

    // Unified bulk operation state (replaces separate isBulkInstalling / isBulkUpdating flags)
    // When active: { type: 'install'|'update'|'activate', total: N, completed: N, btnSelector: '#...' }
    let bulkOperation = null;

    // DOM elements
    const $grid = $('#flm-plugins-grid');
    const $loading = $('#flm-plugins-loading');
    const $error = $('#flm-plugins-error');
    const $empty = $('#flm-plugins-empty');
    const $errorMessage = $('#flm-error-message');

    /**
     * Initialize the page
     */
    function init() {
        bindEvents();
        fetchPlugins();
    }

    /**
     * Bind event handlers
     */
    function bindEvents() {
        // Refresh button
        $('#flm-refresh-plugins, #flm-retry-btn').on('click', function() {
            fetchPlugins();
        });

        // Filter buttons
        $('.flm-filter-btn').on('click', function() {
            const filter = $(this).data('filter');
            setFilter(filter);
        });

        // Plugin action buttons (delegated)
        $grid.on('click', '.flm-action-btn', function() {
            const $btn = $(this);
            const action = $btn.data('action');
            const $card = $btn.closest('.flm-plugin-card');

            handlePluginAction(action, $card, $btn);
        });

        // Bulk install button
        $(document).on('click', '#flm-bulk-install-btn', function() {
            if (!bulkOperation) {
                bulkInstallRequired();
            }
        });

        // Bulk activate button
        $(document).on('click', '#flm-activate-all-btn', function() {
            if (!bulkOperation) {
                bulkActivateRequired();
            }
        });

        // Update All button
        $(document).on('click', '#flm-update-all-btn', function() {
            if (!bulkOperation) {
                updateAll();
            }
        });
    }

    // ─────────────────────────────────────────────────
    // Bulk Operation Helpers
    // ─────────────────────────────────────────────────

    /**
     * Update the active bulk button's progress text based on bulkOperation state
     */
    function updateBulkProgressText() {
        if (!bulkOperation) return;

        let progressString;
        switch (bulkOperation.type) {
            case 'install':
                progressString = flmPlugins.strings.bulkInstalling;
                break;
            case 'activate':
                progressString = flmPlugins.strings.bulkActivating;
                break;
            case 'update':
                progressString = flmPlugins.strings.bulkUpdating;
                break;
        }

        const $btn = $(bulkOperation.btnSelector);
        $btn.find('.flm-bulk-text').text(
            progressString.replace('%1$d', bulkOperation.completed).replace('%2$d', bulkOperation.total)
        );
    }

    /**
     * Disable all bulk buttons except the one currently running
     */
    function disableOtherBulkButtons(activeBtnSelector) {
        ['#flm-bulk-install-btn', '#flm-activate-all-btn', '#flm-update-all-btn'].forEach(function(sel) {
            if (sel !== activeBtnSelector) {
                $(sel).prop('disabled', true);
            }
        });
    }

    /**
     * Re-enable all bulk buttons after a bulk operation completes
     */
    function enableAllBulkButtons() {
        ['#flm-bulk-install-btn', '#flm-activate-all-btn', '#flm-update-all-btn'].forEach(function(sel) {
            $(sel).prop('disabled', false);
        });
    }

    // ─────────────────────────────────────────────────
    // Data Fetching
    // ─────────────────────────────────────────────────

    /**
     * Fetch plugins from portal
     */
    function fetchPlugins() {
        showLoading();

        $('#flm-refresh-plugins').addClass('loading');

        $.ajax({
            url: flmPlugins.ajaxUrl,
            type: 'POST',
            data: {
                action: flmPlugins.isActivated ? 'flm_fetch_plugins' : 'flm_fetch_public_plugins',
                nonce: flmPlugins.nonce
            },
            success: function(response) {
                $('#flm-refresh-plugins').removeClass('loading');

                if (response.success) {
                    pluginsData = response.data.plugins || [];
                    renderPlugins();
                    updateStats();
                    updateFilterCounts();
                } else {
                    showError(response.data.message || flmPlugins.strings.fetchError);
                }
            },
            error: function() {
                $('#flm-refresh-plugins').removeClass('loading');
                showError(flmPlugins.strings.fetchError);
            }
        });
    }

    // ─────────────────────────────────────────────────
    // Rendering
    // ─────────────────────────────────────────────────

    /**
     * Render plugins grid
     */
    function renderPlugins() {
        const filteredPlugins = filterPlugins(pluginsData, currentFilter);

        if (filteredPlugins.length === 0) {
            showEmpty();
            return;
        }

        const template = wp.template('flm-plugin-card');
        let html = '';

        filteredPlugins.forEach(function(plugin) {
            // Determine status for filtering
            plugin.status = getPluginStatus(plugin);
            html += template(plugin);
        });

        $grid.html(html).show();
        $loading.hide();
        $error.hide();
        $empty.hide();

        // Re-disable buttons and re-show overlays for any in-flight operations
        reapplyBusyState();
    }

    /**
     * Get plugin status for filtering
     */
    function getPluginStatus(plugin) {
        if (!plugin.is_installed) return 'not-installed';
        if (plugin.has_update) return 'updates';
        if (plugin.is_active_local) return 'active';
        return 'inactive';
    }

    /**
     * Filter plugins based on current filter
     */
    function filterPlugins(plugins, filter) {
        if (filter === 'all') return plugins;

        return plugins.filter(function(plugin) {
            switch (filter) {
                case 'active':
                    return plugin.is_installed && plugin.is_active_local;
                case 'inactive':
                    return plugin.is_installed && !plugin.is_active_local && !plugin.has_update;
                case 'updates':
                    return plugin.has_update;
                case 'not-installed':
                    return !plugin.is_installed;
                default:
                    return true;
            }
        });
    }

    /**
     * Set active filter
     */
    function setFilter(filter) {
        currentFilter = filter;

        $('.flm-filter-btn').removeClass('active');
        $('.flm-filter-btn[data-filter="' + filter + '"]').addClass('active');

        renderPlugins();
    }

    // ─────────────────────────────────────────────────
    // Stats & Filter Counts
    // ─────────────────────────────────────────────────

    /**
     * Update stats display and bulk action button visibility
     */
    function updateStats() {
        const total = pluginsData.length;
        const active = pluginsData.filter(p => p.is_installed && p.is_active_local).length;
        const inactive = pluginsData.filter(p => p.is_installed && !p.is_active_local).length;
        const updates = pluginsData.filter(p => p.has_update).length;
        const requiredNotInstalled = pluginsData.filter(p => p.priority === 'required' && !p.is_installed).length;
        const requiredInactive = pluginsData.filter(p => p.priority === 'required' && p.is_installed && !p.is_active_local).length;

        $('#stat-total').text(total);
        $('#stat-active').text(active);
        $('#stat-inactive').text(inactive);
        $('#stat-updates').text(updates);
        $('#stat-required').text(pluginsData.filter(p => p.priority === 'required').length);

        // Hide bulk actions entirely for unlicensed users (no download capability)
        if (!flmPlugins.isActivated) {
            $('#flm-bulk-actions').hide();
            return;
        }

        const showBulkInstall = requiredNotInstalled > 0;
        const showBulkActivate = requiredInactive > 0;
        const showBulkUpdate = updates > 0;

        // During a bulk operation, keep the active button visible (shows progress), hide others
        if (bulkOperation) {
            $('#flm-bulk-actions').show();

            if (bulkOperation.type === 'install') {
                $('#flm-bulk-install-btn').show();
                $('#flm-activate-all-btn').hide();
                $('#flm-update-all-btn').hide();
            } else if (bulkOperation.type === 'activate') {
                $('#flm-bulk-install-btn').hide();
                $('#flm-activate-all-btn').show();
                $('#flm-update-all-btn').hide();
            } else if (bulkOperation.type === 'update') {
                $('#flm-bulk-install-btn').hide();
                $('#flm-activate-all-btn').hide();
                $('#flm-update-all-btn').show();
            }
            return;
        }

        // When idle, show/hide based on data counts
        if (showBulkInstall || showBulkActivate || showBulkUpdate) {
            $('#flm-bulk-actions').show();
        } else {
            $('#flm-bulk-actions').hide();
        }

        if (showBulkInstall) {
            $('#flm-bulk-install-btn').show();
            $('#bulk-required-count').text(requiredNotInstalled);
        } else {
            $('#flm-bulk-install-btn').hide();
        }

        if (showBulkActivate) {
            $('#flm-activate-all-btn').show();
            $('#bulk-activate-count').text(requiredInactive);
        } else {
            $('#flm-activate-all-btn').hide();
        }

        if (showBulkUpdate) {
            $('#flm-update-all-btn').show();
            $('#bulk-update-count').text(updates);
        } else {
            $('#flm-update-all-btn').hide();
        }
    }

    /**
     * Update filter counts
     */
    function updateFilterCounts() {
        const counts = {
            all: pluginsData.length,
            active: pluginsData.filter(p => p.is_installed && p.is_active_local).length,
            inactive: pluginsData.filter(p => p.is_installed && !p.is_active_local && !p.has_update).length,
            updates: pluginsData.filter(p => p.has_update).length,
            'not-installed': pluginsData.filter(p => !p.is_installed).length
        };

        Object.keys(counts).forEach(function(key) {
            $('#filter-count-' + key).text(counts[key]);
        });
    }

    // ─────────────────────────────────────────────────
    // Card Button Helpers
    // ─────────────────────────────────────────────────

    /**
     * Disable action buttons for a specific plugin card
     */
    function disableCardButtons(slug) {
        $grid.find('.flm-plugin-card[data-slug="' + slug + '"] .flm-action-btn').prop('disabled', true);
    }

    /**
     * Re-enable action buttons for a specific plugin card
     */
    function enableCardButtons(slug) {
        $grid.find('.flm-plugin-card[data-slug="' + slug + '"] .flm-action-btn').prop('disabled', false);
    }

    /**
     * After renderPlugins() rebuilds the DOM, re-disable buttons and re-show
     * overlays for all slugs that still have in-flight or queued operations.
     */
    function reapplyBusyState() {
        pluginQueues.forEach(function(state, slug) {
            disableCardButtons(slug);

            if (state.overlayText) {
                const $card = $grid.find('.flm-plugin-card[data-slug="' + slug + '"]');
                const $overlay = $card.find('.flm-plugin-card-overlay');
                $overlay.find('.flm-overlay-text').text(state.overlayText);
                $overlay.show();
            }
        });
    }

    // ─────────────────────────────────────────────────
    // Per-Plugin Queue Processing
    // ─────────────────────────────────────────────────

    /**
     * Handle plugin action (install, activate, update, deactivate)
     *
     * Pushes to the per-plugin queue and calls processPluginQueue().
     * Different plugins can have concurrent AJAX requests while
     * same-plugin operations remain serialized.
     */
    function handlePluginAction(action, $card, $btn) {
        const slug = $btn.data('slug');
        const pluginFile = $btn.data('plugin-file');
        const downloadUrl = $btn.data('download-url');
        const source = $btn.data('source') || 'portal';
        const wpOrgSlug = $btn.data('wp-org-slug') || slug;

        // Block individual clicks on plugins that are part of a running bulk operation
        if (bulkOperation && pluginQueues.has(slug)) {
            return;
        }

        // Get file_hash from plugin data for integrity verification
        const plugin = pluginsData.find(p => p.slug === slug);
        const fileHash = plugin ? (plugin.file_hash || '') : '';

        let ajaxAction, ajaxData, loadingText;

        switch (action) {
            case 'install':
                if (source === 'wordpress.org') {
                    ajaxAction = 'flm_install_wporg_plugin';
                    ajaxData = { wp_org_slug: wpOrgSlug };
                } else {
                    ajaxAction = 'flm_install_plugin';
                    ajaxData = { plugin_slug: slug, download_url: downloadUrl, file_hash: fileHash };
                }
                loadingText = flmPlugins.strings.installing;
                break;
            case 'activate':
                ajaxAction = 'flm_activate_plugin';
                ajaxData = { plugin_file: pluginFile };
                loadingText = flmPlugins.strings.activating;
                break;
            case 'update':
                if (source === 'wordpress.org') {
                    ajaxAction = 'flm_update_wporg_plugin';
                    ajaxData = { plugin_file: pluginFile };
                } else {
                    ajaxAction = 'flm_update_plugin';
                    ajaxData = { plugin_file: pluginFile, download_url: downloadUrl, file_hash: fileHash };
                }
                loadingText = flmPlugins.strings.updating;
                break;
            case 'deactivate':
                ajaxAction = 'flm_deactivate_plugin';
                ajaxData = { plugin_file: pluginFile };
                loadingText = flmPlugins.strings.deactivating;
                break;
            default:
                return;
        }

        // Create per-plugin queue entry if needed
        if (!pluginQueues.has(slug)) {
            pluginQueues.set(slug, { active: false, queue: [], overlayText: null });
        }

        pluginQueues.get(slug).queue.push({
            action: action,
            slug: slug,
            ajaxAction: ajaxAction,
            ajaxData: ajaxData,
            loadingText: loadingText
        });

        // Only disable THIS plugin's card
        disableCardButtons(slug);

        // Process THIS plugin's queue
        processPluginQueue(slug);
    }

    /**
     * Process the next item in a specific plugin's queue.
     *
     * Each plugin slug has its own queue so different plugins can have
     * concurrent AJAX requests while same-plugin operations stay serialized.
     */
    function processPluginQueue(slug) {
        const state = pluginQueues.get(slug);
        if (!state || state.active || state.queue.length === 0) {
            if (state && !state.active && state.queue.length === 0) {
                // This plugin's queue is fully drained — clean up
                pluginQueues.delete(slug);
                enableCardButtons(slug);

                // For serial bulk operations (e.g. activate), start the next plugin
                if (bulkOperation && bulkOperation.serialQueue && bulkOperation.serialQueue.length > 0) {
                    const nextSlug = bulkOperation.serialQueue.shift();
                    processPluginQueue(nextSlug);
                } else if (bulkOperation && pluginQueues.size === 0) {
                    finishBulkOperation();
                }
            }
            return;
        }

        state.active = true;

        const item = state.queue.shift();
        const { action, ajaxAction, ajaxData, loadingText, isBulkItem } = item;

        // Refresh $card reference from DOM (may have been rebuilt by renderPlugins)
        const $card = $grid.find('.flm-plugin-card[data-slug="' + slug + '"]');

        // Show loading overlay on this card
        if ($card.length) {
            const $overlay = $card.find('.flm-plugin-card-overlay');
            $overlay.find('.flm-overlay-text').text(loadingText);
            $overlay.show();
        }

        // Track overlay text so reapplyBusyState() can restore it after DOM rebuilds
        state.overlayText = loadingText;

        $.ajax({
            url: flmPlugins.ajaxUrl,
            type: 'POST',
            data: Object.assign({
                action: ajaxAction,
                nonce: flmPlugins.nonce
            }, ajaxData),
            success: function(response) {
                // Refresh $card again (DOM may have changed during AJAX)
                const $card = $grid.find('.flm-plugin-card[data-slug="' + slug + '"]');

                if ($card.length) {
                    $card.find('.flm-plugin-card-overlay').hide();
                }

                // Update bulk progress on completion (only for bulk-enqueued items)
                if (bulkOperation && isBulkItem) {
                    bulkOperation.completed++;
                    updateBulkProgressText();
                }

                // Clear active state BEFORE re-rendering so reapplyBusyState()
                // doesn't re-show the overlay on freshly built DOM nodes
                state.active = false;
                state.overlayText = null;

                if (response.success) {
                    updatePluginData(slug, action);

                    if ($card.length) {
                        $card.addClass('success');
                        setTimeout(function() {
                            $card.removeClass('success');
                        }, 2000);
                    }

                    if (action === 'update' && !bulkOperation) {
                        const plugin = pluginsData.find(p => p.slug === slug);
                        if (plugin && !plugin.is_active_local) {
                            setFilter('inactive');
                        } else if (plugin && plugin.is_active_local) {
                            setFilter('active');
                        }
                    } else {
                        renderPlugins();
                    }
                    updateStats();
                    updateFilterCounts();
                } else {
                    if ($card.length) {
                        $card.addClass('error');
                        setTimeout(function() {
                            $card.removeClass('error');
                        }, 3000);
                    }
                    // Skip blocking alert during bulk operations — card error state is sufficient
                    if (!bulkOperation) {
                        alert(response.data.message || flmPlugins.strings.error);
                    }
                }

                // Process next item for this plugin
                processPluginQueue(slug);
            },
            error: function() {
                const $card = $grid.find('.flm-plugin-card[data-slug="' + slug + '"]');

                if ($card.length) {
                    $card.find('.flm-plugin-card-overlay').hide();
                    $card.addClass('error');
                    setTimeout(function() {
                        $card.removeClass('error');
                    }, 3000);
                }

                // Clear active state before any potential re-rendering
                state.active = false;
                state.overlayText = null;

                // Update bulk progress on error too (only for bulk-enqueued items)
                if (bulkOperation && isBulkItem) {
                    bulkOperation.completed++;
                    updateBulkProgressText();
                }

                // Skip blocking alert during bulk operations — card error state is sufficient
                if (!bulkOperation) {
                    alert(flmPlugins.strings.error);
                }

                // Continue processing even on error
                processPluginQueue(slug);
            }
        });
    }

    // ─────────────────────────────────────────────────
    // Bulk Operations
    // ─────────────────────────────────────────────────

    /**
     * Bulk install all required plugins that are not installed.
     * Uses per-plugin concurrent queues (same pattern as updateAll).
     */
    function bulkInstallRequired() {
        const requiredPlugins = pluginsData.filter(p =>
            p.priority === 'required' && !p.is_installed
        );

        if (requiredPlugins.length === 0) {
            return;
        }

        const btnSelector = '#flm-bulk-install-btn';
        bulkOperation = { type: 'install', total: requiredPlugins.length, completed: 0, btnSelector: btnSelector };

        const $btn = $(btnSelector);
        $btn.prop('disabled', true).addClass('loading');
        updateBulkProgressText();
        disableOtherBulkButtons(btnSelector);

        requiredPlugins.forEach(function(plugin) {
            const source = plugin.source || 'portal';
            const fileHash = plugin.file_hash || '';
            let ajaxAction, ajaxData;

            if (source === 'wordpress.org') {
                ajaxAction = 'flm_install_wporg_plugin';
                ajaxData = { wp_org_slug: plugin.wp_org_slug || plugin.slug };
            } else {
                ajaxAction = 'flm_install_plugin';
                ajaxData = {
                    plugin_slug: plugin.slug,
                    download_url: plugin.download_url,
                    file_hash: fileHash
                };
            }

            if (!pluginQueues.has(plugin.slug)) {
                pluginQueues.set(plugin.slug, { active: false, queue: [], overlayText: null });
            }

            pluginQueues.get(plugin.slug).queue.push({
                action: 'install',
                slug: plugin.slug,
                ajaxAction: ajaxAction,
                ajaxData: ajaxData,
                loadingText: flmPlugins.strings.installing,
                isBulkItem: true
            });

            disableCardButtons(plugin.slug);
            processPluginQueue(plugin.slug);
        });
    }

    /**
     * Bulk activate all required plugins that are installed but inactive.
     *
     * Unlike install/update, activations MUST run serially because WordPress's
     * activate_plugin() reads the shared `active_plugins` option, appends, and
     * saves — concurrent writes cause a last-write-wins race condition.
     */
    function bulkActivateRequired() {
        const inactiveRequired = pluginsData.filter(p =>
            p.priority === 'required' && p.is_installed && !p.is_active_local
        );

        if (inactiveRequired.length === 0) {
            return;
        }

        const btnSelector = '#flm-activate-all-btn';
        bulkOperation = { type: 'activate', total: inactiveRequired.length, completed: 0, btnSelector: btnSelector };

        const $btn = $(btnSelector);
        $btn.prop('disabled', true).addClass('loading');
        updateBulkProgressText();
        disableOtherBulkButtons(btnSelector);

        // Enqueue all plugins but DON'T start them yet
        inactiveRequired.forEach(function(plugin) {
            if (!pluginQueues.has(plugin.slug)) {
                pluginQueues.set(plugin.slug, { active: false, queue: [], overlayText: null });
            }

            pluginQueues.get(plugin.slug).queue.push({
                action: 'activate',
                slug: plugin.slug,
                ajaxAction: 'flm_activate_plugin',
                ajaxData: { plugin_file: plugin.plugin_file },
                loadingText: flmPlugins.strings.activating,
                isBulkItem: true
            });

            disableCardButtons(plugin.slug);
        });

        // Store remaining slugs for serial processing; start only the first
        bulkOperation.serialQueue = inactiveRequired.map(p => p.slug);
        const firstSlug = bulkOperation.serialQueue.shift();
        processPluginQueue(firstSlug);
    }

    /**
     * Update All: enqueue update actions for all plugins with available updates
     */
    function updateAll() {
        const updatablePlugins = pluginsData.filter(p => p.has_update);

        if (updatablePlugins.length === 0) {
            return;
        }

        const btnSelector = '#flm-update-all-btn';
        bulkOperation = { type: 'update', total: updatablePlugins.length, completed: 0, btnSelector: btnSelector };

        // Update button state
        const $btn = $(btnSelector);
        $btn.prop('disabled', true).addClass('loading');
        updateBulkProgressText();
        disableOtherBulkButtons(btnSelector);

        // Enqueue each plugin update into its per-plugin queue and fire concurrently
        updatablePlugins.forEach(function(plugin) {
            const source = plugin.source || 'portal';
            const fileHash = plugin.file_hash || '';
            let ajaxAction, ajaxData;

            if (source === 'wordpress.org') {
                ajaxAction = 'flm_update_wporg_plugin';
                ajaxData = { plugin_file: plugin.plugin_file };
            } else {
                ajaxAction = 'flm_update_plugin';
                ajaxData = {
                    plugin_file: plugin.plugin_file,
                    download_url: plugin.download_url,
                    file_hash: fileHash
                };
            }

            if (!pluginQueues.has(plugin.slug)) {
                pluginQueues.set(plugin.slug, { active: false, queue: [], overlayText: null });
            }

            pluginQueues.get(plugin.slug).queue.push({
                action: 'update',
                slug: plugin.slug,
                ajaxAction: ajaxAction,
                ajaxData: ajaxData,
                loadingText: flmPlugins.strings.updating,
                isBulkItem: true
            });

            disableCardButtons(plugin.slug);
            processPluginQueue(plugin.slug);
        });
    }

    /**
     * Finalize any bulk operation: reset button state and show completion
     */
    function finishBulkOperation() {
        if (!bulkOperation) return;

        const type = bulkOperation.type;
        const $btn = $(bulkOperation.btnSelector);

        $btn.prop('disabled', false).removeClass('loading');

        // Restore the button's default label
        switch (type) {
            case 'install':
                $btn.find('.flm-bulk-text').text(flmPlugins.strings.bulkInstallBtn);
                break;
            case 'activate':
                $btn.find('.flm-bulk-text').text(flmPlugins.strings.activateAll);
                break;
            case 'update':
                $btn.find('.flm-bulk-text').text(flmPlugins.strings.updateAll);
                break;
        }

        bulkOperation = null;
        enableAllBulkButtons();

        // Re-render to reflect all changes
        renderPlugins();
        updateStats();
        updateFilterCounts();
    }

    // ─────────────────────────────────────────────────
    // Plugin Data Updates
    // ─────────────────────────────────────────────────

    /**
     * Update plugin data after action
     */
    function updatePluginData(slug, action) {
        const pluginIndex = pluginsData.findIndex(p => p.slug === slug);
        if (pluginIndex === -1) return;

        const plugin = pluginsData[pluginIndex];

        switch (action) {
            case 'install':
                plugin.is_installed = true;
                plugin.is_active_local = false;
                plugin.installed_version = plugin.latest_version;
                break;
            case 'activate':
                plugin.is_active_local = true;
                break;
            case 'deactivate':
                plugin.is_active_local = false;
                break;
            case 'update':
                plugin.has_update = false;
                plugin.installed_version = plugin.latest_version;
                break;
        }

        pluginsData[pluginIndex] = plugin;
    }

    // ─────────────────────────────────────────────────
    // UI State Helpers
    // ─────────────────────────────────────────────────

    /**
     * Show loading state
     */
    function showLoading() {
        $loading.show();
        $grid.hide();
        $error.hide();
        $empty.hide();
    }

    /**
     * Show error state
     */
    function showError(message) {
        $errorMessage.text(message);
        $error.show();
        $loading.hide();
        $grid.hide();
        $empty.hide();
    }

    /**
     * Show empty state
     */
    function showEmpty() {
        $empty.show();
        $loading.hide();
        $grid.hide();
        $error.hide();
    }

    // Initialize on document ready
    $(document).ready(init);

})(jQuery);
