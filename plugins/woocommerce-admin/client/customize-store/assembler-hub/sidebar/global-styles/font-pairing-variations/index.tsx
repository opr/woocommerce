/* eslint-disable @woocommerce/dependency-group */
/* eslint-disable @typescript-eslint/ban-ts-comment */
/**
 * External dependencies
 */
// @ts-ignore No types for this exist yet.
import { __experimentalGrid as Grid, Spinner } from '@wordpress/components';
import { OPTIONS_STORE_NAME } from '@woocommerce/data';
import { useSelect } from '@wordpress/data';
import { useMemo } from '@wordpress/element';

/**
 * Internal dependencies
 */
import { FONT_PAIRINGS } from './constants';
import { VariationContainer } from '../variation-container';
import { FontPairingVariationPreview } from './preview';
import { Look } from '~/customize-store/design-with-ai/types';

export const FontPairing = () => {
	const { aiSuggestions, isLoading } = useSelect( ( select ) => {
		const { getOption, hasFinishedResolution } =
			select( OPTIONS_STORE_NAME );
		return {
			aiSuggestions: getOption(
				'woocommerce_customize_store_ai_suggestions'
			) as { lookAndFeel: Look },
			isLoading: ! hasFinishedResolution( 'getOption', [
				'woocommerce_customize_store_ai_suggestions',
			] ),
		};
	} );

	const fontPairings = useMemo(
		() =>
			aiSuggestions?.lookAndFeel
				? FONT_PAIRINGS.filter( ( font ) =>
						font.lookAndFeel.includes( aiSuggestions?.lookAndFeel )
				  )
				: FONT_PAIRINGS,
		[ aiSuggestions ]
	);

	if ( isLoading ) {
		return (
			<div className="woocommerce-customize-store_font-pairing-spinner-container">
				<Spinner />
			</div>
		);
	}

	return (
		<Grid
			columns={ 2 }
			gap={ 3 }
			className="woocommerce-customize-store_font-pairing-container"
			style={ {
				opacity: 0,
				animation: 'containerFadeIn 300ms ease-in-out forwards',
			} }
		>
			{ fontPairings.map( ( variation, index ) => (
				<VariationContainer key={ index } variation={ variation }>
					<FontPairingVariationPreview />
				</VariationContainer>
			) ) }
		</Grid>
	);
};
