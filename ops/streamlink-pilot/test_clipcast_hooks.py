from clipcast_template.hooks import Detection, choose_hook


def test_hook_names_a_visible_subject_and_changes_with_the_clip():
    car = Detection("car", 0.71, 0.48, 0.7, 0.3)
    bike = Detection("bike", 0.76, 0.22, 0.57, 0.09)
    assert choose_hook([[car], [car]], []).text == "KEEP AN EYE ON THE CAR UP FRONT"
    assert choose_hook([[bike], [bike]], []).text == "WATCH THE BIKE ON THE LEFT"


def test_combines_relevant_dialogue_and_objects_without_guessing_crash():
    car = Detection("car", 0.68, 0.52, 0.48, 0.18)
    unrelated = choose_hook([[car]], ["I might crash this thing one day."])
    confirmed = choose_hook([[car]], ["I just crashed."])
    assert "CRASH" not in unrelated.text
    assert "CRASH THAT CAR" in confirmed.text
    assert confirmed.source == "frames and dialogue"


def test_writes_hook_from_known_details_or_leaves_it_blank():
    assert (
        choose_hook([], ["Four bikes. One late arrival."]).text == "WHO SHOWED UP LATE?"
    )
    assert choose_hook([], ["We beat the game."]).text == "THEY FINALLY BEAT THE GAME"
    assert choose_hook([], ["I just lost my getaway vehicle."]).text == "THERE GOES THE GETAWAY CAR"
    assert not choose_hook([], ["If we beat the game, I can go home."]).text
    assert not choose_hook([], ["Yeah, maybe."]).text
