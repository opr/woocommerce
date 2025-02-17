/**
 * External dependencies
 */
import { Button, Modal } from '@wordpress/components';
import { Sender } from 'xstate';
import { __ } from '@wordpress/i18n';

/**
 * Internal dependencies
 */
import { customizeStoreStateMachineEvents } from '../..';

export const GoBackWarningModal = ( {
	setOpenWarningModal,
	sendEvent,
	classname = 'woocommerce-customize-store__design-change-warning-modal',
}: {
	setOpenWarningModal: ( arg0: boolean ) => void;
	sendEvent: Sender< customizeStoreStateMachineEvents >;
	classname?: string;
} ) => {
	return (
		<Modal
			className={ classname }
			title={ __( 'Are you sure you want to exit?', 'woocommerce' ) }
			onRequestClose={ () => setOpenWarningModal( false ) }
			shouldCloseOnClickOutside={ false }
		>
			<p>
				{ __(
					"You'll lose any changes you've made to your store's design and will start the process again.",
					'woocommerce'
				) }
			</p>
			<div className="woocommerce-customize-store__design-change-warning-modal-footer">
				<Button
					onClick={ () => sendEvent( 'GO_BACK_TO_DESIGN_WITH_AI' ) }
					variant="link"
				>
					{ __( 'Exit and lose changes', 'woocommerce' ) }
				</Button>
				<Button
					onClick={ () => setOpenWarningModal( false ) }
					variant="primary"
				>
					{ __( 'Continue designing', 'woocommerce' ) }
				</Button>
			</div>
		</Modal>
	);
};
